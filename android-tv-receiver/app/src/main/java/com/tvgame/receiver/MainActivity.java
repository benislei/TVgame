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

    private final Object lifecycleLock = new Object();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final StatsModel stats = new StatsModel();
    private final Runnable updateOverlay = new Runnable() {
        @Override
        public void run() {
            overlay.setText(TITLE + "\n" + RECEIVER_MODE + "（API " + Build.VERSION.SDK_INT + "）\n" + stats.render());
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
    private boolean keyAActive;
    private boolean keyDActive;
    private boolean keyWActive;
    private boolean keySActive;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        inputClient = new InputClient(resolveInputRelayHost(), INPUT_RELAY_PORT);

        surfaceView = new SurfaceView(this);
        surfaceView.getHolder().addCallback(this);

        overlay = new TextView(this);
        overlay.setTextColor(0xFFFFFFFF);
        overlay.setTextSize(16);
        overlay.setBackgroundColor(0x99000000);
        overlay.setPadding(16, 12, 16, 12);
        overlay.setText(TITLE + "\n" + RECEIVER_MODE + "（API " + Build.VERSION.SDK_INT + "）\n等待视频和音频");

        FrameLayout root = new FrameLayout(this);
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

    @Override
    public boolean onGenericMotionEvent(MotionEvent event) {
        int source = event.getSource();
        boolean isGamepad = (source & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
            || (source & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD;
        if (!isGamepad || event.getAction() != MotionEvent.ACTION_MOVE || inputClient == null) {
            return super.onGenericMotionEvent(event);
        }

        float axisX = event.getAxisValue(MotionEvent.AXIS_X);
        float axisY = event.getAxisValue(MotionEvent.AXIS_Y);
        if (Math.abs(axisX) < GAMEPAD_AXIS_DEADZONE) {
            axisX = event.getAxisValue(MotionEvent.AXIS_HAT_X);
        }
        if (Math.abs(axisY) < GAMEPAD_AXIS_DEADZONE) {
            axisY = event.getAxisValue(MotionEvent.AXIS_HAT_Y);
        }

        keyAActive = updateMappedKey("KeyA", keyAActive, axisX <= -GAMEPAD_AXIS_DEADZONE);
        keyDActive = updateMappedKey("KeyD", keyDActive, axisX >= GAMEPAD_AXIS_DEADZONE);
        keyWActive = updateMappedKey("KeyW", keyWActive, axisY <= -GAMEPAD_AXIS_DEADZONE);
        keySActive = updateMappedKey("KeyS", keySActive, axisY >= GAMEPAD_AXIS_DEADZONE);
        return true;
    }

    private boolean updateMappedKey(String code, boolean wasActive, boolean shouldBeActive) {
        if (inputClient == null || wasActive == shouldBeActive) {
            return wasActive;
        }
        inputClient.sendCode(shouldBeActive ? "down" : "up", code);
        return shouldBeActive;
    }

    private void releaseMappedKeys() {
        keyAActive = updateMappedKey("KeyA", keyAActive, false);
        keyDActive = updateMappedKey("KeyD", keyDActive, false);
        keyWActive = updateMappedKey("KeyW", keyWActive, false);
        keySActive = updateMappedKey("KeyS", keySActive, false);
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
