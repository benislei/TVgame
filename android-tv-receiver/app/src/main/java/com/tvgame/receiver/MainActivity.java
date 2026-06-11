package com.tvgame.receiver;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

public final class MainActivity extends Activity implements SurfaceHolder.Callback {
    private static final String TITLE = "电视游戏接收端";
    private static final String RECEIVER_MODE = "接收端档位：Android 11+ 极致模式";
    private static final String INPUT_RELAY_HOST_METADATA = "com.tvgame.receiver.INPUT_RELAY_HOST";
    private static final String INPUT_RELAY_AUTO_TEXT = "自动识别中";
    private static final int INPUT_RELAY_PORT = 8789;
    private static final long STOP_JOIN_MS = 400;
    private static final long VIDEO_HEALTH_SAMPLE_MS = 500;
    private static final long VIDEO_STALL_RESTART_MS = 1200;
    private static final long VIDEO_FRESH_MS = 1500;
    private static final long VIDEO_STALL_MIN_PACKETS = 60;
    private static final float VIDEO_ASPECT_RATIO = 16.0f / 9.0f;
    private static final float GAMEPAD_AXIS_DEADZONE = 0.35f;
    private static final int BUTTON_A = 1 << 0;
    private static final int BUTTON_B = 1 << 1;
    private static final int BUTTON_X = 1 << 2;
    private static final int BUTTON_Y = 1 << 3;
    private static final int BUTTON_LB = 1 << 4;
    private static final int BUTTON_RB = 1 << 5;
    private static final int BUTTON_BACK = 1 << 6;
    private static final int BUTTON_START = 1 << 7;
    private static final int BUTTON_LS = 1 << 8;
    private static final int BUTTON_RS = 1 << 9;
    private static final int BUTTON_DPAD_UP = 1 << 10;
    private static final int BUTTON_DPAD_DOWN = 1 << 11;
    private static final int BUTTON_DPAD_LEFT = 1 << 12;
    private static final int BUTTON_DPAD_RIGHT = 1 << 13;
    private static final int BUTTON_GUIDE = 1 << 14;

    private final Object lifecycleLock = new Object();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final StatsModel stats = new StatsModel();
    private final Runnable updateOverlay = new Runnable() {
        @Override
        public void run() {
            monitorVideoHealth();
            overlay.setText(TITLE + " | Android 11+（API " + Build.VERSION.SDK_INT + "）\n" + stats.renderCompact());
            handler.postDelayed(this, VIDEO_HEALTH_SAMPLE_MS);
        }
    };

    private SurfaceView surfaceView;
    private TextView overlay;
    private H264VideoReceiver videoReceiver;
    private L16AudioReceiver audioReceiver;
    private InputClient inputClient;
    private Thread videoThread;
    private Thread audioThread;
    private Surface activeSurface;
    private long lastVideoHealthPackets = -1;
    private long lastVideoHealthFrames = -1;
    private long videoStallStartedAtMs = -1;
    private boolean videoRestartInProgress;
    private FrameLayout rootView;
    private float gamepadLx;
    private float gamepadLy;
    private float gamepadRx;
    private float gamepadRy;
    private float gamepadLt;
    private float gamepadRt;
    private int gamepadButtons;
    private boolean overlayVisible = true;
    private final View.OnKeyListener gamepadKeyListener = new View.OnKeyListener() {
        @Override
        public boolean onKey(View view, int keyCode, KeyEvent event) {
            return handleGamepadKeyEvent(event);
        }
    };
    private final View.OnGenericMotionListener gamepadMotionListener = new View.OnGenericMotionListener() {
        @Override
        public boolean onGenericMotion(View view, MotionEvent event) {
            return handleGamepadMotionEvent(event);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        stats.deviceLabel = buildDeviceLabel();
        stats.receiverAdvice = buildReceiverAdvice();
        String configuredInputRelayHost = resolveInputRelayHost();
        if (configuredInputRelayHost.length() > 0) {
            setInputRelayHost(configuredInputRelayHost);
        } else {
            stats.inputRelayHost = INPUT_RELAY_AUTO_TEXT;
        }

        surfaceView = new SurfaceView(this);
        surfaceView.setFocusable(true);
        surfaceView.setFocusableInTouchMode(true);
        surfaceView.setOnKeyListener(gamepadKeyListener);
        surfaceView.setOnGenericMotionListener(gamepadMotionListener);
        surfaceView.getHolder().addCallback(this);

        overlay = new TextView(this);
        overlay.setTextColor(0xFFFFFFFF);
        overlay.setTextSize(12);
        overlay.setBackgroundColor(0x77000000);
        overlay.setPadding(8, 6, 8, 6);
        overlay.setText(TITLE + " | Android 11+（API " + Build.VERSION.SDK_INT + "）\n等待视频和音频");

        FrameLayout root = new FrameLayout(this);
        rootView = root;
        root.setBackgroundColor(0xFF000000);
        root.setFocusable(true);
        root.setFocusableInTouchMode(true);
        root.setOnKeyListener(gamepadKeyListener);
        root.setOnGenericMotionListener(gamepadMotionListener);
        root.addOnLayoutChangeListener(new View.OnLayoutChangeListener() {
            @Override
            public void onLayoutChange(
                View view,
                int left,
                int top,
                int right,
                int bottom,
                int oldLeft,
                int oldTop,
                int oldRight,
                int oldBottom
            ) {
                updateSurfaceLayout();
            }
        });
        root.addView(surfaceView);

        FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.START
        );
        root.addView(overlay, overlayParams);

        setContentView(root);
        updateSurfaceLayout();
        applyImmersiveFlags();
        requestInputFocus();
        handler.postDelayed(updateOverlay, 500);
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        activeSurface = holder.getSurface();
        startReceivers(activeSurface);
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
        updateSurfaceLayout();
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        activeSurface = null;
        stopReceivers();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(updateOverlay);
        if (surfaceView != null) {
            surfaceView.getHolder().removeCallback(this);
        }
        if (inputClient != null) {
            releaseMappedKeys();
            inputClient.close();
            inputClient = null;
        }
        activeSurface = null;
        stopReceivers();
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        int action = event.getAction();
        if (action == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0 && isOverlayToggleKey(keyCode)) {
            toggleOverlay();
            return true;
        }
        if (isOverlayToggleKey(keyCode)) {
            return true;
        }
        if (handleGamepadKeyEvent(event)) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (handleGamepadMotionEvent(event)) {
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveFlags();
            requestInputFocus();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (inputClient != null && event.getRepeatCount() == 0) {
            inputClient.sendKey("down", keyCode);
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (inputClient != null) {
            inputClient.sendKey("up", keyCode);
        }
        return super.onKeyUp(keyCode, event);
    }

    private static boolean isOverlayToggleKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_F1;
    }

    private static boolean isGamepadKeyEvent(KeyEvent event) {
        int source = event.getSource();
        int keyCode = event.getKeyCode();
        return (source & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
            || (source & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            || (source & InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD
            || isGamepadButtonKey(keyCode);
    }

    private static boolean isGamepadButtonKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_UP
            || keyCode == KeyEvent.KEYCODE_DPAD_DOWN
            || keyCode == KeyEvent.KEYCODE_DPAD_LEFT
            || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
            || keyCode == KeyEvent.KEYCODE_DPAD_CENTER
            || (keyCode >= KeyEvent.KEYCODE_BUTTON_A && keyCode <= KeyEvent.KEYCODE_BUTTON_MODE);
    }

    private void toggleOverlay() {
        overlayVisible = !overlayVisible;
        if (overlay != null) {
            overlay.setVisibility(overlayVisible ? View.VISIBLE : View.GONE);
        }
    }

    @Override
    public boolean onGenericMotionEvent(MotionEvent event) {
        if (handleGamepadMotionEvent(event)) {
            return true;
        }
        return super.onGenericMotionEvent(event);
    }

    private boolean handleGamepadMotionEvent(MotionEvent event) {
        int source = event.getSource();
        boolean isGamepad = (source & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            || (source & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD;
        if (!isGamepad || event.getAction() != MotionEvent.ACTION_MOVE || inputClient == null) {
            return false;
        }

        gamepadLx = normalizeAxis(event.getAxisValue(MotionEvent.AXIS_X));
        gamepadLy = normalizeAxis(event.getAxisValue(MotionEvent.AXIS_Y));
        gamepadRx = normalizeAxis(firstActiveAxis(event, MotionEvent.AXIS_Z, MotionEvent.AXIS_RX));
        gamepadRy = normalizeAxis(firstActiveAxis(event, MotionEvent.AXIS_RZ, MotionEvent.AXIS_RY));
        gamepadLt = normalizeTrigger(event.getAxisValue(MotionEvent.AXIS_LTRIGGER));
        gamepadRt = normalizeTrigger(event.getAxisValue(MotionEvent.AXIS_RTRIGGER));

        float hatX = event.getAxisValue(MotionEvent.AXIS_HAT_X);
        float hatY = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
        gamepadButtons = updateHatButton(gamepadButtons, BUTTON_DPAD_LEFT, hatX <= -GAMEPAD_AXIS_DEADZONE);
        gamepadButtons = updateHatButton(gamepadButtons, BUTTON_DPAD_RIGHT, hatX >= GAMEPAD_AXIS_DEADZONE);
        gamepadButtons = updateHatButton(gamepadButtons, BUTTON_DPAD_UP, hatY <= -GAMEPAD_AXIS_DEADZONE);
        gamepadButtons = updateHatButton(gamepadButtons, BUTTON_DPAD_DOWN, hatY >= GAMEPAD_AXIS_DEADZONE);
        sendGamepadState();
        return true;
    }

    private boolean handleGamepadKeyEvent(KeyEvent event) {
        if (!isGamepadKeyEvent(event)) {
            return false;
        }
        int action = event.getAction();
        if (action != KeyEvent.ACTION_DOWN && action != KeyEvent.ACTION_UP) {
            return true;
        }

        int buttonBit = mapGamepadButtonBit(event.getKeyCode());
        if (buttonBit != 0 && (action == KeyEvent.ACTION_UP || event.getRepeatCount() == 0)) {
            if (action == KeyEvent.ACTION_DOWN) {
                gamepadButtons |= buttonBit;
            } else {
                gamepadButtons &= ~buttonBit;
            }
            sendGamepadState();
        }
        return true;
    }

    private static float firstActiveAxis(MotionEvent event, int firstAxis, int fallbackAxis) {
        float value = event.getAxisValue(firstAxis);
        if (Math.abs(value) >= GAMEPAD_AXIS_DEADZONE) {
            return value;
        }
        return event.getAxisValue(fallbackAxis);
    }

    private static float normalizeAxis(float value) {
        if (Math.abs(value) < GAMEPAD_AXIS_DEADZONE) {
            return 0.0f;
        }
        return Math.max(-1.0f, Math.min(1.0f, value));
    }

    private static float normalizeTrigger(float value) {
        if (value < GAMEPAD_AXIS_DEADZONE) {
            return 0.0f;
        }
        return Math.max(0.0f, Math.min(1.0f, value));
    }

    private static int updateHatButton(int buttons, int buttonBit, boolean pressed) {
        return pressed ? (buttons | buttonBit) : (buttons & ~buttonBit);
    }

    private static int mapGamepadButtonBit(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
                return BUTTON_DPAD_UP;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                return BUTTON_DPAD_DOWN;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                return BUTTON_DPAD_LEFT;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return BUTTON_DPAD_RIGHT;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
                return BUTTON_A;
            case KeyEvent.KEYCODE_BUTTON_B:
                return BUTTON_B;
            case KeyEvent.KEYCODE_BUTTON_X:
                return BUTTON_X;
            case KeyEvent.KEYCODE_BUTTON_Y:
                return BUTTON_Y;
            case KeyEvent.KEYCODE_BUTTON_L1:
                return BUTTON_LB;
            case KeyEvent.KEYCODE_BUTTON_R1:
                return BUTTON_RB;
            case KeyEvent.KEYCODE_BUTTON_L2:
                return BUTTON_LB;
            case KeyEvent.KEYCODE_BUTTON_R2:
                return BUTTON_RB;
            case KeyEvent.KEYCODE_BUTTON_START:
                return BUTTON_START;
            case KeyEvent.KEYCODE_BUTTON_SELECT:
                return BUTTON_BACK;
            case KeyEvent.KEYCODE_BUTTON_THUMBL:
                return BUTTON_LS;
            case KeyEvent.KEYCODE_BUTTON_THUMBR:
                return BUTTON_RS;
            case KeyEvent.KEYCODE_BUTTON_MODE:
                return BUTTON_GUIDE;
            default:
                return 0;
        }
    }

    private void sendGamepadState() {
        if (inputClient != null) {
            stats.recordGamepadState(gamepadLx, gamepadLy, gamepadRx, gamepadRy, gamepadLt, gamepadRt, gamepadButtons, System.currentTimeMillis());
            inputClient.sendGamepadState(gamepadLx, gamepadLy, gamepadRx, gamepadRy, gamepadLt, gamepadRt, gamepadButtons);
        }
    }

    private void requestInputFocus() {
        if (rootView != null) {
            rootView.requestFocus();
        }
        if (surfaceView != null) {
            surfaceView.requestFocus();
        }
    }

    private void applyImmersiveFlags() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private void updateSurfaceLayout() {
        if (rootView == null || surfaceView == null) {
            return;
        }

        int rootWidth = rootView.getWidth();
        int rootHeight = rootView.getHeight();
        if (rootWidth <= 0 || rootHeight <= 0) {
            return;
        }

        int targetWidth = rootWidth;
        int targetHeight = Math.round(targetWidth / VIDEO_ASPECT_RATIO);
        if (targetHeight > rootHeight) {
            targetHeight = rootHeight;
            targetWidth = Math.round(targetHeight * VIDEO_ASPECT_RATIO);
        }

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(targetWidth, targetHeight, Gravity.CENTER);
        surfaceView.setLayoutParams(params);
    }

    private void releaseMappedKeys() {
        gamepadLx = 0.0f;
        gamepadLy = 0.0f;
        gamepadRx = 0.0f;
        gamepadRy = 0.0f;
        gamepadLt = 0.0f;
        gamepadRt = 0.0f;
        gamepadButtons = 0;
        sendGamepadState();
    }

    private void updateInputRelayHost(String host) {
        if (host == null || host.trim().length() == 0) {
            return;
        }

        final String trimmedHost = host.trim();
        handler.post(new Runnable() {
            @Override
            public void run() {
                setInputRelayHost(trimmedHost);
            }
        });
    }

    private void setInputRelayHost(String host) {
        if (host == null || host.trim().length() == 0) {
            return;
        }

        host = host.trim();
        if (host.equals(stats.inputRelayHost)) {
            return;
        }

        InputClient oldClient = inputClient;
        if (oldClient != null) {
            releaseMappedKeys();
            oldClient.close();
        }

        stats.inputRelayHost = host;
        inputClient = new InputClient(host, INPUT_RELAY_PORT, stats);
    }

    private static String buildDeviceLabel() {
        String manufacturer = cleanBuildText(Build.MANUFACTURER);
        String model = cleanBuildText(Build.MODEL);
        String hardware = cleanBuildText(Build.HARDWARE);
        String label = (manufacturer + " " + model).trim();
        if (label.length() == 0) {
            label = "未知设备";
        }
        if (hardware.length() > 0) {
            label += " / " + hardware;
        }
        return label;
    }

    private String buildReceiverAdvice() {
        PackageManager packageManager = getPackageManager();
        boolean tvDevice = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
            || packageManager.hasSystemFeature(PackageManager.FEATURE_TELEVISION);
        if (isAmlogicOrXiaomiBox()) {
            return "小米盒子稳定档";
        }
        if (tvDevice) {
            return "电视盒子稳定档";
        }
        return "默认1080p60";
    }

    private static boolean isAmlogicOrXiaomiBox() {
        return containsIgnoreCase(Build.MANUFACTURER, "xiaomi")
            || containsIgnoreCase(Build.MODEL, "mitv")
            || containsIgnoreCase(Build.MODEL, "xiaomi")
            || containsIgnoreCase(Build.HARDWARE, "amlogic");
    }

    private static boolean containsIgnoreCase(String text, String value) {
        if (text == null || value == null) {
            return false;
        }
        return text.toLowerCase().contains(value.toLowerCase());
    }

    private static String cleanBuildText(String text) {
        if (text == null) {
            return "";
        }
        text = text.trim();
        if (text.length() == 0 || "unknown".equalsIgnoreCase(text)) {
            return "";
        }
        return text;
    }

    private void startReceivers(Surface surface) {
        synchronized (lifecycleLock) {
            if (hasRunningReceiverThreads()) {
                return;
            }

            activeSurface = surface;
            resetVideoHealthWatch();
            startVideoReceiverLocked(surface);
            startAudioReceiverLocked();
        }
    }

    private void stopReceivers() {
        synchronized (lifecycleLock) {
            stopVideoReceiverLocked();
            stopAudioReceiverLocked();
            resetVideoHealthWatch();
        }
    }

    private void startVideoReceiverLocked(Surface surface) {
        if (surface == null || !surface.isValid()) {
            return;
        }
        videoReceiver = new H264VideoReceiver(surface, stats, new H264VideoReceiver.SenderAddressListener() {
            @Override
            public void onSenderAddress(String host) {
                updateInputRelayHost(host);
            }
        });
        videoThread = new Thread(videoReceiver, "RTP 视频接收");
        videoThread.start();
    }

    private void startAudioReceiverLocked() {
        audioReceiver = new L16AudioReceiver(stats);
        audioThread = new Thread(audioReceiver, "RTP 音频接收");
        audioThread.start();
    }

    private boolean stopVideoReceiverLocked() {
        if (videoReceiver != null) {
            videoReceiver.stop();
        }
        boolean videoStopped = waitForReceiverThread(videoThread);
        videoReceiver = null;
        if (videoStopped) {
            videoThread = null;
        }
        return videoStopped;
    }

    private boolean stopAudioReceiverLocked() {
        if (audioReceiver != null) {
            audioReceiver.stop();
        }
        boolean audioStopped = waitForReceiverThread(audioThread);
        audioReceiver = null;
        if (audioStopped) {
            audioThread = null;
        }
        return audioStopped;
    }

    private void monitorVideoHealth() {
        long nowMs = System.currentTimeMillis();
        long packets = stats.videoPackets;
        long frames = stats.videoFrames;

        if (lastVideoHealthPackets < 0 || lastVideoHealthFrames < 0) {
            rememberVideoHealth(packets, frames);
            return;
        }

        boolean packetsMoving = packets > lastVideoHealthPackets;
        boolean framesMoving = frames > lastVideoHealthFrames;
        boolean videoFresh = stats.lastVideoAtMs > 0 && nowMs - stats.lastVideoAtMs <= VIDEO_FRESH_MS;
        boolean enoughPackets = packets >= VIDEO_STALL_MIN_PACKETS;

        if (!packetsMoving || framesMoving || !videoFresh || !enoughPackets) {
            videoStallStartedAtMs = -1;
        } else if (videoStallStartedAtMs < 0) {
            videoStallStartedAtMs = nowMs;
        } else if (nowMs - videoStallStartedAtMs >= VIDEO_STALL_RESTART_MS) {
            restartVideoReceiverFromWatchdog();
            videoStallStartedAtMs = -1;
        }

        rememberVideoHealth(packets, frames);
    }

    private void restartVideoReceiverFromWatchdog() {
        if (videoRestartInProgress) {
            return;
        }
        if (activeSurface == null || !activeSurface.isValid()) {
            return;
        }

        videoRestartInProgress = true;
        try {
            synchronized (lifecycleLock) {
                if (activeSurface == null || !activeSurface.isValid()) {
                    return;
                }
                if (stopVideoReceiverLocked()) {
                    stats.videoRestarts++;
                    startVideoReceiverLocked(activeSurface);
                }
                resetVideoHealthWatch();
            }
        } finally {
            videoRestartInProgress = false;
        }
    }

    private void rememberVideoHealth(long packets, long frames) {
        lastVideoHealthPackets = packets;
        lastVideoHealthFrames = frames;
    }

    private void resetVideoHealthWatch() {
        lastVideoHealthPackets = -1;
        lastVideoHealthFrames = -1;
        videoStallStartedAtMs = -1;
    }

    private boolean hasRunningReceiverThreads() {
        if (videoThread != null && videoThread.isAlive()) {
            return true;
        }
        return audioThread != null && audioThread.isAlive();
    }

    private boolean waitForReceiverThread(Thread thread) {
        if (thread == null) {
            return true;
        }
        try {
            thread.join(STOP_JOIN_MS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
        return !thread.isAlive();
    }

    private String resolveInputRelayHost() {
        try {
            ApplicationInfo info = getPackageManager().getApplicationInfo(
                getPackageName(),
                PackageManager.GET_META_DATA
            );
            if (info.metaData != null) {
                String host = info.metaData.getString(INPUT_RELAY_HOST_METADATA);
                if (host != null && host.trim().length() > 0) {
                    return host.trim();
                }
            }
        } catch (PackageManager.NameNotFoundException ex) {
            // Keep automatic discovery enabled when no explicit build-time host is configured.
        }
        return "";
    }
}
