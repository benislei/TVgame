package com.tvgame.receiver;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.widget.FrameLayout;
import android.widget.TextView;

public final class MainActivity extends Activity implements SurfaceHolder.Callback {
    private static final String TITLE = "电视游戏接收端";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final StatsModel stats = new StatsModel();
    private final Runnable updateOverlay = new Runnable() {
        @Override
        public void run() {
            overlay.setText(TITLE + "\n" + stats.render());
            handler.postDelayed(this, 500);
        }
    };

    private SurfaceView surfaceView;
    private TextView overlay;
    private H264VideoReceiver videoReceiver;
    private L16AudioReceiver audioReceiver;
    private Thread videoThread;
    private Thread audioThread;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        surfaceView = new SurfaceView(this);
        surfaceView.getHolder().addCallback(this);

        overlay = new TextView(this);
        overlay.setTextColor(0xFFFFFFFF);
        overlay.setTextSize(16);
        overlay.setBackgroundColor(0x99000000);
        overlay.setPadding(16, 12, 16, 12);
        overlay.setText(TITLE + "\n等待视频和音频");

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
        stopReceivers();
        super.onDestroy();
    }

    private void startReceivers(Surface surface) {
        if (videoThread != null && videoThread.isAlive()) {
            return;
        }

        videoReceiver = new H264VideoReceiver(surface, stats);
        audioReceiver = new L16AudioReceiver(stats);
        videoThread = new Thread(videoReceiver, "RTP 视频接收");
        audioThread = new Thread(audioReceiver, "RTP 音频接收");
        videoThread.start();
        audioThread.start();
    }

    private void stopReceivers() {
        if (videoReceiver != null) {
            videoReceiver.stop();
            videoReceiver = null;
        }
        if (audioReceiver != null) {
            audioReceiver.stop();
            audioReceiver = null;
        }
        videoThread = null;
        audioThread = null;
    }
}
