package de.stegmann.brickmerge;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

final class NativeBridge {
    private static final int MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
    private static final int MAX_REQUEST_BYTES = 8 * 1024;
    private static final Set<String> ALLOWED_HOSTS = allowedHosts();

    private final Context context;
    private final WebView webView;
    private final SharedPreferences preferences;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, Future<?>> requests = new ConcurrentHashMap<>();

    NativeBridge(Context context, WebView webView) {
        this.context = context.getApplicationContext();
        this.webView = webView;
        this.preferences = context.getSharedPreferences("brickmerge_js", Context.MODE_PRIVATE);
    }

    @JavascriptInterface public String getValue(String key) {
        return preferences.getString(String.valueOf(key), null);
    }

    @JavascriptInterface public void setValue(String key, String jsonValue) {
        preferences.edit().putString(String.valueOf(key), String.valueOf(jsonValue)).apply();
    }

    @JavascriptInterface public void deleteValue(String key) {
        preferences.edit().remove(String.valueOf(key)).apply();
    }

    @JavascriptInterface public void copyText(String text) {
        webView.post(() -> {
            ClipboardManager clipboard = (ClipboardManager)
                    context.getSystemService(Context.CLIPBOARD_SERVICE);
            if (clipboard != null) {
                clipboard.setPrimaryClip(ClipData.newPlainText("Brickmerge", String.valueOf(text)));
            }
        });
    }

    @JavascriptInterface public void request(
            String id,
            String rawUrl,
            String rawMethod,
            String headersJson,
            String body,
            int timeoutMs
    ) {
        String requestId = String.valueOf(id);
        Future<?> future = executor.submit(() -> performRequest(
                requestId,
                rawUrl,
                rawMethod,
                headersJson,
                body,
                timeoutMs
        ));
        Future<?> previous = requests.put(requestId, future);
        if (previous != null) previous.cancel(true);
    }

    @JavascriptInterface public void abortRequest(String id) {
        Future<?> future = requests.remove(String.valueOf(id));
        if (future != null) future.cancel(true);
    }

    void destroy() {
        for (Future<?> future : requests.values()) future.cancel(true);
        requests.clear();
        executor.shutdownNow();
    }

    private void performRequest(
            String id,
            String rawUrl,
            String rawMethod,
            String headersJson,
            String body,
            int timeoutMs
    ) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(rawUrl);
            String host = url.getHost().toLowerCase(Locale.ROOT);
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !isAllowedHost(host)) {
                complete(id, error("Nicht erlaubte Zieladresse."));
                return;
            }

            String method = String.valueOf(rawMethod).toUpperCase(Locale.ROOT);
            boolean dismissalWrite = method.equals("POST") &&
                    host.equals("getdata.andreas-9b7.workers.dev") &&
                    url.getPath().equals("/offers/dismissals");
            if (!method.equals("GET") && !dismissalWrite) {
                complete(id, error("Methode nicht erlaubt."));
                return;
            }
            byte[] requestBody = body == null ? new byte[0] : body.getBytes(StandardCharsets.UTF_8);
            if (requestBody.length > MAX_REQUEST_BYTES) {
                complete(id, error("Anfrage zu groß."));
                return;
            }

            int timeout = Math.max(1_000, Math.min(timeoutMs > 0 ? timeoutMs : 15_000, 30_000));
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(timeout);
            connection.setReadTimeout(timeout);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestMethod(method);
            connection.setRequestProperty("User-Agent", "BrickmergeApp/1.0 Android");
            connection.setRequestProperty("Accept", "*/*");

            JSONObject headers = headersJson == null || headersJson.isEmpty()
                    ? new JSONObject()
                    : new JSONObject(headersJson);
            java.util.Iterator<String> headerNames = headers.keys();
            while (headerNames.hasNext()) {
                String name = headerNames.next();
                if (name.matches("(?i)^(user-agent|referer|origin|host|content-length|cookie)$")) {
                    continue;
                }
                connection.setRequestProperty(name, headers.optString(name, ""));
            }

            if (dismissalWrite) {
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(requestBody);
                }
            }

            int status = connection.getResponseCode();
            java.io.InputStream rawStream = status >= 400
                    ? connection.getErrorStream()
                    : connection.getInputStream();
            String responseText = rawStream == null ? "" : readBounded(rawStream);
            JSONObject result = new JSONObject();
            result.put("ok", true);
            result.put("status", status);
            result.put("responseText", responseText);
            result.put("responseHeaders", serializeHeaders(connection));
            result.put("finalUrl", connection.getURL().toString());
            complete(id, result);
        } catch (Exception exception) {
            complete(id, error(exception.getMessage() == null
                    ? "Netzwerkfehler"
                    : exception.getMessage()));
        } finally {
            requests.remove(id);
            if (connection != null) connection.disconnect();
        }
    }

    private void complete(String id, JSONObject result) {
        String script = "window.__bmNativeComplete(" + JSONObject.quote(id) + "," + result + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private static JSONObject error(String message) {
        JSONObject result = new JSONObject();
        try {
            result.put("ok", false);
            result.put("error", String.valueOf(message));
        } catch (Exception ignored) {}
        return result;
    }

    private static String readBounded(java.io.InputStream stream) throws Exception {
        try (BufferedInputStream input = new BufferedInputStream(stream);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16_384];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_RESPONSE_BYTES) throw new IllegalStateException("Antwort zu groß");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String serializeHeaders(HttpURLConnection connection) {
        StringBuilder result = new StringBuilder();
        for (Map.Entry<String, java.util.List<String>> entry :
                connection.getHeaderFields().entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) continue;
            for (String value : entry.getValue()) {
                if (result.length() > 0) result.append("\r\n");
                result.append(entry.getKey()).append(": ").append(value);
            }
        }
        return result.toString();
    }

    private static boolean isAllowedHost(String host) {
        return ALLOWED_HOSTS.contains(host) || host.endsWith(".brickowl.com");
    }

    private static Set<String> allowedHosts() {
        Set<String> hosts = new HashSet<>();
        hosts.add("brickmerge.de");
        hosts.add("www.brickmerge.de");
        hosts.add("getdata.andreas-9b7.workers.dev");
        hosts.add("brickmerge-toolkit-api.andreas-9b7.workers.dev");
        hosts.add("ebay-price-api.andreas-9b7.workers.dev");
        hosts.add("bricklink.com");
        hosts.add("www.bricklink.com");
        hosts.add("brickowl.com");
        hosts.add("www.brickowl.com");
        hosts.add("rebrickable.com");
        hosts.add("www.rebrickable.com");
        hosts.add("brickbank.app");
        hosts.add("duckduckgo.com");
        return hosts;
    }
}
