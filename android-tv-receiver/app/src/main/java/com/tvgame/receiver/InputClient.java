package com.tvgame.receiver;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;

public final class InputClient {
    private static final int CONNECT_TIMEOUT_MS = 250;
    private static final int SOCKET_TIMEOUT_MS = 250;

    private final String host;
    private final int port;
    private final ExecutorService executor;
    private volatile boolean closed;

    public InputClient(String host, int port) {
        this.host = host;
        this.port = port;
        this.executor = Executors.newSingleThreadExecutor(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable runnable) {
                Thread thread = new Thread(runnable, "tvgame-input-sender");
                thread.setDaemon(true);
                return thread;
            }
        });
    }

    public void sendKey(String action, int keyCode) {
        if (!("down".equals(action) || "up".equals(action))) {
            return;
        }
        if (closed) {
            return;
        }

        final String line = "{\"type\":\"input\",\"kind\":\"keyboard\",\"action\":\""
            + action
            + "\",\"keyCode\":"
            + keyCode
            + "}\n";

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
