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

    private final String host;
    private final int port;
    private final ExecutorService executor;
    private volatile boolean closed;

    public InputClient(String host, int port) {
        this.host = host;
        this.port = port;
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

    private void sendLine(String line) {
        if (closed) {
            return;
        }

        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            socket.setSoTimeout(SOCKET_TIMEOUT_MS);
            OutputStream output = socket.getOutputStream();
            output.write(line.getBytes(StandardCharsets.UTF_8));
            output.flush();
        } catch (IOException ex) {
            // The PC relay is optional in this stage; input failures must not crash playback.
        } finally {
            try {
                socket.close();
            } catch (IOException ex) {
                // Nothing useful to do during cleanup.
            }
        }
    }
}
