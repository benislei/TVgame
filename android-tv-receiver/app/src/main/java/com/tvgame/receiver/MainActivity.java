package com.tvgame.receiver;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.TypedValue;
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
import android.widget.LinearLayout;
import android.widget.TextView;

import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.util.Enumeration;

public final class MainActivity extends Activity implements SurfaceHolder.Callback {
    private static final String TITLE = "电视游戏接收端";
    private static final String RECEIVER_MODE = "接收端档位：Android 11+ 极致模式";
    private static final String INPUT_RELAY_HOST_METADATA = "com.tvgame.receiver.INPUT_RELAY_HOST";
    private static final String INPUT_RELAY_AUTO_TEXT = "自动识别中";
    private static final int VIDEO_PORT = 5004;
    private static final int AUDIO_PORT = 5006;
    private static final int INPUT_RELAY_PORT = 8789;
    private static final int COLOR_BG = 0xFF06100D;
    private static final int COLOR_PANEL = 0xEA10241E;
    private static final int COLOR_PANEL_SOFT = 0xD9122A22;
    private static final int COLOR_FIELD = 0xF207120F;
    private static final int COLOR_TEXT = 0xFFF5FFF8;
    private static final int COLOR_MUTED = 0xFF9FC4B5;
    private static final int COLOR_ACCENT = 0xFF20D47D;
    private static final int COLOR_ACCENT_SOFT = 0x5532E88E;
    private static final int COLOR_AMBER = 0xFFE8BD65;
    private static final int COLOR_BORDER = 0x443EE49A;
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
            updateWaitingLayer(System.currentTimeMillis());
            overlay.setText(TITLE + " | Android 11+（API " + Build.VERSION.SDK_INT + "）\n" + stats.renderCompact());
            handler.postDelayed(this, VIDEO_HEALTH_SAMPLE_MS);
        }
    };

    private SurfaceView surfaceView;
    private TextView overlay;
    private FrameLayout waitingLayer;
    private TextView waitingHeadline;
    private TextView waitingSubline;
    private TextView localIpValue;
    private TextView videoPortValue;
    private TextView audioPortValue;
    private TextView inputPortValue;
    private TextView topStatusChip;
    private TextView streamPreviewFps;
    private TextView streamPreviewLoss;
    private TextView streamPreviewAudio;
    private String localIp = "未识别";
    private H264VideoReceiver videoReceiver;
    private L16AudioReceiver audioReceiver;
    private InputClient inputClient;
    private DiscoveryBroadcaster discoveryBroadcaster;
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
    private boolean overlayVisible;
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
        localIp = resolveLocalIpv4Address();
        discoveryBroadcaster = new DiscoveryBroadcaster(stats);
        discoveryBroadcaster.start();
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
        overlay.setTextColor(COLOR_TEXT);
        overlay.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        overlay.setTypeface(Typeface.MONOSPACE);
        overlay.setBackground(rounded(0xB8000000, 0x6643D988, 1, 10));
        overlay.setPadding(dp(10), dp(8), dp(10), dp(8));
        overlay.setText(TITLE + " | Android 11+（API " + Build.VERSION.SDK_INT + "）\n等待视频和音频");
        overlay.setVisibility(View.GONE);

        FrameLayout root = new FrameLayout(this);
        rootView = root;
        root.setBackgroundColor(COLOR_BG);
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
        waitingLayer = buildWaitingLayer();
        root.addView(waitingLayer, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.START
        );
        overlayParams.setMargins(dp(14), dp(14), dp(14), dp(14));
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
        if (discoveryBroadcaster != null) {
            discoveryBroadcaster.stop();
            discoveryBroadcaster = null;
        }
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

    private FrameLayout buildWaitingLayer() {
        FrameLayout layer = new FrameLayout(this);
        layer.setBackgroundColor(COLOR_BG);
        layer.addView(new ReceiverBackdropView(this), new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        LinearLayout brandRow = new LinearLayout(this);
        brandRow.setGravity(Gravity.CENTER_VERTICAL);
        brandRow.setOrientation(LinearLayout.HORIZONTAL);
        BrandMarkView brandMark = new BrandMarkView(this);
        LinearLayout.LayoutParams markParams = new LinearLayout.LayoutParams(wdp(48), wdp(48));
        brandRow.addView(brandMark, markParams);

        LinearLayout brandCopy = new LinearLayout(this);
        brandCopy.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams brandCopyParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        brandCopyParams.setMargins(wdp(12), 0, 0, 0);
        TextView title = text("TVGame 接收端", 22, COLOR_TEXT, Typeface.BOLD);
        TextView subtitle = text("局域网游戏串流", 12, COLOR_MUTED, Typeface.NORMAL);
        subtitle.setPadding(0, wdp(5), 0, 0);
        brandCopy.addView(title);
        brandCopy.addView(subtitle);
        brandRow.addView(brandCopy, brandCopyParams);

        FrameLayout.LayoutParams brandParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.START
        );
        brandParams.setMargins(wdp(48), wdp(38), 0, 0);
        layer.addView(brandRow, brandParams);

        LinearLayout chipRow = new LinearLayout(this);
        chipRow.setOrientation(LinearLayout.HORIZONTAL);
        chipRow.setGravity(Gravity.CENTER_VERTICAL);
        topStatusChip = chip("监听中", COLOR_ACCENT, COLOR_ACCENT_SOFT);
        chipRow.addView(topStatusChip);
        chipRow.addView(chip("Android 11+", COLOR_TEXT, 0x2214A96F), marginLeft(wdp(9)));
        chipRow.addView(chip("按比例显示", COLOR_TEXT, 0x2214A96F), marginLeft(wdp(9)));
        FrameLayout.LayoutParams chipsParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.END
        );
        chipsParams.setMargins(0, wdp(42), wdp(52), 0);
        layer.addView(chipRow, chipsParams);

        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER_HORIZONTAL);
        BrandMarkView heroMark = new BrandMarkView(this);
        center.addView(heroMark, new LinearLayout.LayoutParams(wdp(68), wdp(68)));

        waitingHeadline = text("等待电脑发送画面", 26, COLOR_TEXT, Typeface.BOLD);
        waitingHeadline.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams headlineParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        headlineParams.setMargins(0, wdp(18), 0, 0);
        center.addView(waitingHeadline, headlineParams);

        waitingSubline = text("在发送端输入这台电视的 IP。连接成功后自动进入全屏，复杂诊断默认隐藏。", 13, COLOR_MUTED, Typeface.NORMAL);
        waitingSubline.setGravity(Gravity.CENTER);
        waitingSubline.setMaxWidth(wdp(760));
        waitingSubline.setPadding(0, wdp(12), 0, 0);
        center.addView(waitingSubline);

        LinearLayout metricStrip = new LinearLayout(this);
        metricStrip.setGravity(Gravity.CENTER);
        metricStrip.setOrientation(LinearLayout.HORIZONTAL);
        metricStrip.setPadding(wdp(8), wdp(8), wdp(8), wdp(8));
        metricStrip.setBackground(rounded(0x8A08120F, 0x333EE49A, 1, 26));
        localIpValue = metricValue("本机 IP", localIp);
        videoPortValue = metricValue("视频端口", String.valueOf(VIDEO_PORT));
        audioPortValue = metricValue("音频端口", String.valueOf(AUDIO_PORT));
        inputPortValue = metricValue("输入端口", String.valueOf(INPUT_RELAY_PORT));
        metricStrip.addView(localIpValue, metricItemParams(230));
        metricStrip.addView(videoPortValue, metricItemParams(145));
        metricStrip.addView(audioPortValue, metricItemParams(145));
        metricStrip.addView(inputPortValue, metricItemParams(145));
        LinearLayout.LayoutParams stripParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        stripParams.setMargins(0, wdp(30), 0, 0);
        center.addView(metricStrip, stripParams);

        FrameLayout.LayoutParams centerParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        centerParams.setMargins(0, 0, 0, compactWaitingLayout() ? wdp(190) : wdp(86));
        layer.addView(center, centerParams);

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.HORIZONTAL);
        bottom.setGravity(Gravity.CENTER);
        bottom.addView(infoCard("推荐操作", "发送端手动输入 IP", "手动输入更稳定，自动搜索仅作为辅助入口。"), weightedCardParams());
        bottom.addView(infoCard("输入回传", "手柄与键鼠", "识别到输入设备后回传到电脑端输入桥。"), weightedCardParams());
        bottom.addView(streamPreviewCard(), weightedCardParams());
        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        bottomParams.setMargins(wdp(48), 0, wdp(48), wdp(38));
        layer.addView(bottom, bottomParams);

        return layer;
    }

    private void updateWaitingLayer(long nowMs) {
        boolean videoActive = hasFreshVideo(nowMs);
        if (waitingLayer != null) {
            waitingLayer.setVisibility(videoActive ? View.GONE : View.VISIBLE);
        }
        if (topStatusChip != null) {
            topStatusChip.setText(videoActive ? "接收中" : "监听中");
        }
        if (waitingHeadline != null) {
            waitingHeadline.setText(stats.videoFrames > 0 ? "等待电脑继续发送画面" : "等待电脑发送画面");
        }
        if (localIpValue != null) {
            localIpValue.setText("本机 IP\n" + localIp);
        }
        if (videoPortValue != null) {
            videoPortValue.setText("视频端口\n" + VIDEO_PORT);
        }
        if (audioPortValue != null) {
            audioPortValue.setText("音频端口\n" + AUDIO_PORT);
        }
        if (inputPortValue != null) {
            inputPortValue.setText("输入端口\n" + INPUT_RELAY_PORT);
        }
        if (streamPreviewFps != null) {
            streamPreviewFps.setText("画面\n" + (stats.videoFrames > 0 ? "已收到" : "--"));
        }
        if (streamPreviewLoss != null) {
            streamPreviewLoss.setText("丢包\n" + (stats.videoRtpLossPackets > 0 ? String.valueOf(stats.videoRtpLossPackets) : "--"));
        }
        if (streamPreviewAudio != null) {
            streamPreviewAudio.setText("声音\n" + (stats.audioPackets > 0 ? "正常" : "--"));
        }
    }

    private boolean hasFreshVideo(long nowMs) {
        return stats.videoFrames > 0 && stats.lastVideoAtMs > 0 && nowMs - stats.lastVideoAtMs <= VIDEO_FRESH_MS;
    }

    private TextView text(String value, int sp, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextColor(color);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, wsp(sp));
        view.setTypeface(Typeface.DEFAULT, style);
        view.setIncludeFontPadding(false);
        view.setLineSpacing(0.0f, 1.05f);
        return view;
    }

    private TextView chip(String value, int color, int fillColor) {
        TextView view = text(value, 12, color, Typeface.BOLD);
        view.setGravity(Gravity.CENTER);
        view.setPadding(wdp(16), wdp(8), wdp(16), wdp(8));
        view.setBackground(rounded(fillColor, 0x554EE89F, 1, 24));
        return view;
    }

    private TextView metricValue(String label, String value) {
        TextView view = text(label + "\n" + value, 16, COLOR_TEXT, Typeface.BOLD);
        view.setGravity(Gravity.CENTER_VERTICAL);
        view.setPadding(wdp(14), wdp(9), wdp(14), wdp(9));
        view.setBackground(rounded(COLOR_FIELD, 0x0020D47D, 0, 16));
        return view;
    }

    private LinearLayout infoCard(String label, String title, String body) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(wdp(17), wdp(14), wdp(17), wdp(14));
        card.setBackground(rounded(COLOR_PANEL_SOFT, 0x6632E88E, 1, 22));
        card.addView(text(label, 11, COLOR_ACCENT, Typeface.BOLD));
        TextView titleView = text(title, 17, COLOR_TEXT, Typeface.BOLD);
        titleView.setPadding(0, wdp(8), 0, 0);
        titleView.setMaxLines(2);
        card.addView(titleView);
        TextView bodyView = text(body, 11, COLOR_MUTED, Typeface.NORMAL);
        bodyView.setPadding(0, wdp(7), 0, 0);
        bodyView.setMaxLines(3);
        card.addView(bodyView);
        return card;
    }

    private LinearLayout streamPreviewCard() {
        LinearLayout card = infoCard("串流浮层预览", "诊断默认隐藏", "按菜单键或 F1 可切换诊断浮层。");
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(0, wdp(10), 0, 0);
        streamPreviewFps = smallMetric("画面", "--");
        streamPreviewLoss = smallMetric("丢包", "--");
        streamPreviewAudio = smallMetric("声音", "--");
        row.addView(streamPreviewFps, equalSmallMetricParams());
        row.addView(streamPreviewLoss, equalSmallMetricParams());
        row.addView(streamPreviewAudio, equalSmallMetricParams());
        card.addView(row);
        return card;
    }

    private TextView smallMetric(String label, String value) {
        TextView view = text(label + "\n" + value, 11, COLOR_TEXT, Typeface.BOLD);
        view.setPadding(wdp(10), wdp(8), wdp(10), wdp(8));
        view.setBackground(rounded(0xB20A1713, 0, 0, 14));
        return view;
    }

    private GradientDrawable rounded(int color, int strokeColor, int strokeDp, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) {
            drawable.setStroke(dp(strokeDp), strokeColor);
        }
        return drawable;
    }

    private LinearLayout.LayoutParams marginLeft(int leftDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(leftDp, 0, 0, 0);
        return params;
    }

    private LinearLayout.LayoutParams metricItemParams(int widthDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(wdp(widthDp), LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(wdp(5), 0, wdp(5), 0);
        return params;
    }

    private LinearLayout.LayoutParams weightedCardParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        params.setMargins(wdp(9), 0, wdp(9), 0);
        return params;
    }

    private LinearLayout.LayoutParams equalSmallMetricParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
        params.setMargins(wdp(3), 0, wdp(3), 0);
        return params;
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private int wdp(float value) {
        return dp(value * waitingUiScale());
    }

    private int wsp(float value) {
        return Math.max(9, Math.round(value * waitingUiScale()));
    }

    private float waitingUiScale() {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int shortSide = Math.min(metrics.widthPixels, metrics.heightPixels);
        if (shortSide <= 720) {
            return 0.64f;
        }
        if (shortSide <= 1080) {
            return 0.76f;
        }
        if (shortSide <= 1440) {
            return 0.88f;
        }
        return 1.0f;
    }

    private boolean compactWaitingLayout() {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        return Math.min(metrics.widthPixels, metrics.heightPixels) <= 1200;
    }

    private static String resolveLocalIpv4Address() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface item = interfaces.nextElement();
                if (!item.isUp() || item.isLoopback() || item.isVirtual()) {
                    continue;
                }
                Enumeration<java.net.InetAddress> addresses = item.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    java.net.InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        String hostAddress = address.getHostAddress();
                        if (hostAddress != null && !hostAddress.startsWith("169.254.")) {
                            return hostAddress;
                        }
                    }
                }
            }
        } catch (Exception ex) {
            return "未识别";
        }
        return "未识别";
    }

    private static final class ReceiverBackdropView extends View {
        private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint gridPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();

        ReceiverBackdropView(Context context) {
            super(context);
            setWillNotDraw(false);
            fillPaint.setStyle(Paint.Style.FILL);
            strokePaint.setStyle(Paint.Style.STROKE);
            strokePaint.setStrokeWidth(dpFor(context, 1.2f));
            gridPaint.setStyle(Paint.Style.STROKE);
            gridPaint.setStrokeWidth(dpFor(context, 1));
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            int width = getWidth();
            int height = getHeight();
            fillPaint.setColor(COLOR_BG);
            canvas.drawRect(0, 0, width, height, fillPaint);

            fillPaint.setColor(0x4810A767);
            canvas.drawCircle(width * 0.18f, height * 0.18f, width * 0.22f, fillPaint);
            fillPaint.setColor(0x321EDB88);
            canvas.drawCircle(width * 0.74f, height * 0.38f, width * 0.18f, fillPaint);
            fillPaint.setColor(0x221C6B4A);
            canvas.drawCircle(width * 0.52f, height * 0.84f, width * 0.24f, fillPaint);

            rect.set(width * 0.10f, height * 0.12f, width * 0.90f, height * 0.88f);
            fillPaint.setColor(0xB907110F);
            canvas.drawRoundRect(rect, dpFor(getContext(), 38), dpFor(getContext(), 38), fillPaint);
            strokePaint.setColor(0x333EE49A);
            canvas.drawRoundRect(rect, dpFor(getContext(), 38), dpFor(getContext(), 38), strokePaint);

            gridPaint.setColor(0x123EE49A);
            float step = dpFor(getContext(), 42);
            for (float x = rect.left + step; x < rect.right; x += step) {
                canvas.drawLine(x, rect.top + dpFor(getContext(), 18), x, rect.bottom - dpFor(getContext(), 18), gridPaint);
            }
            for (float y = rect.top + step; y < rect.bottom; y += step) {
                canvas.drawLine(rect.left + dpFor(getContext(), 18), y, rect.right - dpFor(getContext(), 18), y, gridPaint);
            }
        }
    }

    private static final class BrandMarkView extends View {
        private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path playPath = new Path();
        private final RectF rect = new RectF();

        BrandMarkView(Context context) {
            super(context);
            setWillNotDraw(false);
            fillPaint.setStyle(Paint.Style.FILL);
            strokePaint.setStyle(Paint.Style.STROKE);
            strokePaint.setStrokeCap(Paint.Cap.ROUND);
            strokePaint.setStrokeJoin(Paint.Join.ROUND);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth();
            float h = getHeight();
            float unit = Math.min(w, h);
            float pad = unit * 0.08f;
            float radius = unit * 0.22f;

            rect.set(pad, pad, w - pad, h - pad);
            fillPaint.setColor(0xD80C241D);
            canvas.drawRoundRect(rect, radius, radius, fillPaint);
            strokePaint.setStrokeWidth(unit * 0.018f);
            strokePaint.setColor(0x7732E88E);
            canvas.drawRoundRect(rect, radius, radius, strokePaint);

            float left = w * 0.30f;
            float top = h * 0.34f;
            float right = w * 0.70f;
            float bottom = h * 0.60f;
            rect.set(left, top, right, bottom);
            strokePaint.setStrokeWidth(unit * 0.055f);
            strokePaint.setColor(0xFF73F2B0);
            canvas.drawRoundRect(rect, unit * 0.045f, unit * 0.045f, strokePaint);

            playPath.reset();
            playPath.moveTo(w * 0.47f, h * 0.40f);
            playPath.lineTo(w * 0.47f, h * 0.55f);
            playPath.lineTo(w * 0.61f, h * 0.475f);
            playPath.close();
            fillPaint.setColor(COLOR_ACCENT);
            canvas.drawPath(playPath, fillPaint);

            strokePaint.setStrokeWidth(unit * 0.045f);
            strokePaint.setColor(0xFF73F2B0);
            canvas.drawLine(w * 0.45f, h * 0.70f, w * 0.55f, h * 0.70f, strokePaint);
            canvas.drawLine(w * 0.50f, h * 0.60f, w * 0.50f, h * 0.70f, strokePaint);

            strokePaint.setStrokeWidth(unit * 0.035f);
            strokePaint.setColor(0xAA73F2B0);
            canvas.drawArc(w * 0.22f, h * 0.18f, w * 0.78f, h * 0.78f, -140, 34, false, strokePaint);
            canvas.drawArc(w * 0.22f, h * 0.18f, w * 0.78f, h * 0.78f, -74, 34, false, strokePaint);
        }
    }

    private static float dpFor(Context context, float value) {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            context.getResources().getDisplayMetrics()
        );
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
