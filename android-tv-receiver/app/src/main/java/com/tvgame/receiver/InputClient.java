package com.tvgame.receiver;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public final class InputClient {
    private static final int CONNECT_TIMEOUT_MS = 250;
    private static final int SOCKET_TIMEOUT_MS = 250;
    private static final int INPUT_QUEUE_CAPACITY = 16;
    private static final int MAX_KEY_CODE = 10000;
    private static final int MAX_CODE_LENGTH = 32;

    private final String host;
    private final int port;
    private final StatsModel stats;
    private final ExecutorService executor;
    private volatile boolean closed;
    private Socket socket;
    private OutputStream output;

    public InputClient(String host, int port) {
        this(host, port, null);
    }

    public InputClient(String host, int port, StatsModel stats) {
        this.host = host;
        this.port = port;
        this.stats = stats;
        this.executor = new ThreadPoolExecutor(
            1,
            1,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<Runnable>(INPUT_QUEUE_CAPACITY),
            new ThreadFactory() {
                @Override
                public Thread newThread(Runnable runnable) {
                    Thread thread = new Thread(runnable, "tvgame-input-sender");
                    thread.setDaemon(true);
                    return thread;
                }
            },
            new ThreadPoolExecutor.DiscardOldestPolicy()
        );
    }

    public void sendKey(String action, int keyCode) {
        if (closed) {
            return;
        }
        final String line;
        try {
            line = buildKeyJsonLine(action, keyCode);
        } catch (IllegalArgumentException ex) {
            return;
        }

        enqueueLine(line);
    }

    public void sendCode(String action, String code) {
        if (closed) {
            return;
        }
        final String line;
        try {
            line = buildCodeJsonLine(action, code);
        } catch (IllegalArgumentException ex) {
            return;
        }

        enqueueLine(line);
    }

    public void sendMouseMove(int dx, int dy) {
        if (closed || (dx == 0 && dy == 0)) {
            return;
        }

        enqueueLine(buildMouseMoveJsonLine(dx, dy));
    }

    public void sendMouseButton(String action, int button) {
        if (closed) {
            return;
        }
        final String line;
        try {
            line = buildMouseButtonJsonLine(action, button);
        } catch (IllegalArgumentException ex) {
            return;
        }

        enqueueLine(line);
    }

    public void sendGamepadState(float lx, float ly, float rx, float ry, float lt, float rt, int buttons) {
        if (closed) {
            return;
        }

        enqueueLine(buildGamepadStateJsonLine(lx, ly, rx, ry, lt, rt, buttons));
    }

    private void enqueueLine(final String line) {
        try {
            executor.execute(new Runnable() {
                @Override
                public void run() {
                    sendLine(line);
                }
            });
        } catch (RejectedExecutionException ex) {
            // Activity teardown can race with a final key event; dropping it is acceptable.
        }
    }

    public void close() {
        closed = true;
        executor.shutdownNow();
        closeSocket();
    }

    static String buildKeyJsonLine(String action, int keyCode) {
        if (!("down".equals(action) || "up".equals(action))) {
            throw new IllegalArgumentException("action must be down or up");
        }
        if (keyCode < 0 || keyCode > MAX_KEY_CODE) {
            throw new IllegalArgumentException("keyCode out of range");
        }

        return "{\"type\":\"input\",\"kind\":\"keyboard\",\"action\":\""
            + action
            + "\",\"keyCode\":"
            + keyCode
            + "}\n";
    }

    static String buildCodeJsonLine(String action, String code) {
        if (!("down".equals(action) || "up".equals(action))) {
            throw new IllegalArgumentException("action must be down or up");
        }
        if (code == null || code.length() == 0 || code.length() > MAX_CODE_LENGTH
            || !code.matches("[A-Za-z0-9_\\-]+")) {
            throw new IllegalArgumentException("code out of range");
        }

        return "{\"type\":\"input\",\"kind\":\"keyboard\",\"action\":\""
            + action
            + "\",\"code\":\""
            + code
            + "\"}\n";
    }

    static String buildMouseMoveJsonLine(int dx, int dy) {
        return "{\"type\":\"input\",\"kind\":\"mouse\",\"action\":\"move\",\"dx\":"
            + dx
            + ",\"dy\":"
            + dy
            + "}\n";
    }

    static String buildMouseButtonJsonLine(String action, int button) {
        if (!("down".equals(action) || "up".equals(action))) {
            throw new IllegalArgumentException("action must be down or up");
        }
        if (button < 0 || button > 2) {
            throw new IllegalArgumentException("button out of range");
        }

        return "{\"type\":\"input\",\"kind\":\"mouse\",\"action\":\""
            + action
            + "\",\"button\":"
            + button
            + "}\n";
    }

    static String buildGamepadStateJsonLine(float lx, float ly, float rx, float ry, float lt, float rt, int buttons) {
        return "{\"type\":\"input\",\"kind\":\"gamepad\",\"action\":\"state\",\"lx\":"
            + Float.toString(clampStick(lx))
            + ",\"ly\":"
            + Float.toString(clampStick(ly))
            + ",\"rx\":"
            + Float.toString(clampStick(rx))
            + ",\"ry\":"
            + Float.toString(clampStick(ry))
            + ",\"lt\":"
            + Float.toString(clampTrigger(lt))
            + ",\"rt\":"
            + Float.toString(clampTrigger(rt))
            + ",\"buttons\":"
            + Math.max(0, buttons)
            + "}\n";
    }

    private static float clampStick(float value) {
        return Math.max(-1.0f, Math.min(1.0f, value));
    }

    private static float clampTrigger(float value) {
        return Math.max(0.0f, Math.min(1.0f, value));
    }

    private void sendLine(String line) {
        if (closed) {
            return;
        }

        try {
            OutputStream currentOutput = getOrCreateSocket();
            currentOutput.write(line.getBytes(StandardCharsets.UTF_8));
            currentOutput.flush();
            if (stats != null) {
                stats.inputPackets++;
                stats.lastInputAtMs = System.currentTimeMillis();
            }
        } catch (IOException ex) {
            if (stats != null) {
                stats.inputFailures++;
            }
            closeSocket();
            // The PC relay is optional in this stage; input failures must not crash playback.
        }
    }

    private synchronized OutputStream getOrCreateSocket() throws IOException {
        if (socket != null && socket.isConnected() && !socket.isClosed() && output != null) {
            return output;
        }

        closeSocket();
        Socket nextSocket = new Socket();
        nextSocket.setTcpNoDelay(true);
        nextSocket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
        nextSocket.setSoTimeout(SOCKET_TIMEOUT_MS);
        socket = nextSocket;
        output = nextSocket.getOutputStream();
        return output;
    }

    private synchronized void closeSocket() {
        OutputStream currentOutput = output;
        Socket currentSocket = socket;
        output = null;
        socket = null;

        if (currentOutput != null) {
            try {
                currentOutput.close();
            } catch (IOException ex) {
                // Nothing useful to do during cleanup.
            }
        }
        if (currentSocket != null) {
            try {
                currentSocket.close();
            } catch (IOException ex) {
                // Nothing useful to do during cleanup.
            }
        }
    }
}
