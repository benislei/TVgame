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
    private static final String DEFAULT_INPUT_RELAY_HOST = "192.168.50.148";
    private static final int INPUT_RELAY_PORT = 8789;
    private static final long STOP_JOIN_MS = 400;
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
            overlay.setText(TITLE + " | Android 11+（API " + Build.VERSION.SDK_INT + "）\n" + stats.renderCompact());
            handler.postDelayed(this, 500);
        }
    };

    private SurfaceView surfaceView;
    private TextView overlay;
    private H264VideoReceiver videoReceiver;
    private L16AudioReceiver audioReceiver;
    private InputClient inputClient;
    private Thread videoThread;
    private Thread audioThread;
    private float gamepadLx;
    private float gamepadLy;
    private float gamepadRx;
    private float gamepadRy;
    private float gamepadLt;
    private float gamepadRt;
    private int gamepadButtons;
    private boolean overlayVisible = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        inputClient = new InputClient(resolveInputRelayHost(), INPUT_RELAY_PORT);

        surfaceView = new SurfaceView(this);
        surfaceView.getHolder().addCallback(this);

        overlay = new TextView(this);
        overlay.setTextColor(0xFFFFFFFF);
        overlay.setTextSize(12);
        overlay.setBackgroundColor(0x77000000);
        overlay.setPadding(8, 6, 8, 6);
        overlay.setText(TITLE + " | Android 11+（API " + Build.VERSION.SDK_INT + "）\n等待视频和音频");

        FrameLayout root = new FrameLayout(this);
        root.setFocusable(true);
        root.setFocusableInTouchMode(true);
        root.addView(surfaceView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.START
        );
        root.addView(overlay, overlayParams);

        setContentView(root);
        root.requestFocus();
        handler.postDelayed(updateOverlay, 500);
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        startReceivers(holder.getSurface());
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
    }

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
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
        int source = event.getSource();
        boolean isGamepad = (source & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            || (source & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD;
        if (!isGamepad || event.getAction() != MotionEvent.ACTION_MOVE || inputClient == null) {
            return super.onGenericMotionEvent(event);
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
            inputClient.sendGamepadState(gamepadLx, gamepadLy, gamepadRx, gamepadRy, gamepadLt, gamepadRt, gamepadButtons);
        }
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

    private void startReceivers(Surface surface) {
        synchronized (lifecycleLock) {
            if (hasRunningReceiverThreads()) {
                return;
            }

            videoReceiver = new H264VideoReceiver(surface, stats);
            audioReceiver = new L16AudioReceiver(stats);
            videoThread = new Thread(videoReceiver, "RTP 视频接收");
            audioThread = new Thread(audioReceiver, "RTP 音频接收");
            videoThread.start();
            audioThread.start();
        }
    }

    private void stopReceivers() {
        synchronized (lifecycleLock) {
            if (videoReceiver != null) {
                videoReceiver.stop();
            }
            if (audioReceiver != null) {
                audioReceiver.stop();
            }

            boolean videoStopped = waitForReceiverThread(videoThread);
            boolean audioStopped = waitForReceiverThread(audioThread);

            videoReceiver = null;
            audioReceiver = null;
            if (videoStopped) {
                videoThread = null;
            }
            if (audioStopped) {
                audioThread = null;
            }
        }
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
            // Fall back to the documented MVP address.
        }
        return DEFAULT_INPUT_RELAY_HOST;
    }
}
