package de.stegmann.brickmerge;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class InputResolver {
    private static final int MAX_HTML_BYTES = 2 * 1024 * 1024;
    private static final Pattern EAN_PATTERN = Pattern.compile("(?<!\\d)(570201\\d{7})(?!\\d)");
    private static final Pattern EXPLICIT_SET_PATTERN = Pattern.compile(
            "(?i)(?:set(?:nummer|number|nr)?|item(?:nr|number)?|mpn)[^0-9]{0,18}(\\d{3,7})(?!\\d)");
    private static final Pattern NUMBER_PATTERN = Pattern.compile("(?<![A-Za-z0-9])(\\d{3,7})(?![A-Za-z0-9])");
    private static final Pattern JSON_PRODUCT_PATTERN = Pattern.compile(
            "(?i)\\\"(?:mpn|sku|productID|model)\\\"\\s*:\\s*\\\"?(\\d{3,7})(?!\\d)");
    private static final Pattern TITLE_PATTERN = Pattern.compile(
            "(?is)<title[^>]*>(.*?)</title>");
    private static final Pattern TAG_PATTERN = Pattern.compile("(?s)<[^>]+>");
    private static final Pattern HTTP_URL_PATTERN = Pattern.compile(
            "(?i)https?://[^\\s<>\"']+");

    private InputResolver() {}

    static final class Result {
        final String query;
        final boolean fallback;

        Result(String query, boolean fallback) {
            this.query = query;
            this.fallback = fallback;
        }
    }

    static Result resolve(String rawInput) throws Exception {
        String input = normalize(rawInput, 500);
        if (input.isEmpty()) return new Result("", false);
        String url = extractHttpUrl(input);
        if (url == null) return new Result(input, false);

        String direct = candidateFromUrl(url);
        if (direct != null) return new Result(direct, false);

        String html = download(url);
        String candidate = candidateFromHtml(html);
        if (candidate != null) return new Result(candidate, false);

        String title = extractTitle(html);
        if (!title.isEmpty()) return new Result(normalize(title, 120), true);
        return new Result(input, true);
    }

    static String extractHttpUrl(String value) {
        Matcher matcher = HTTP_URL_PATTERN.matcher(String.valueOf(value));
        while (matcher.find()) {
            String candidate = matcher.group().replaceFirst("[),.;!?]+$", "");
            if (isHttpUrl(candidate)) return candidate;
        }
        return null;
    }

    static boolean isHttpUrl(String value) {
        try {
            URI uri = URI.create(String.valueOf(value).trim());
            String scheme = uri.getScheme();
            return uri.getHost() != null &&
                    ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme));
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    static String candidateFromUrl(String rawUrl) {
        String decoded;
        try {
            decoded = java.net.URLDecoder.decode(rawUrl, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            decoded = rawUrl;
        }
        String ean = firstMatch(EAN_PATTERN, decoded, false);
        if (ean != null) return ean;
        String explicit = firstMatch(EXPLICIT_SET_PATTERN, decoded, true);
        if (explicit != null) return explicit;

        String lower = decoded.toLowerCase(Locale.ROOT);
        if (lower.contains("lego") || lower.contains("brickmerge")) {
            return bestSetNumber(decoded);
        }
        return null;
    }

    static String candidateFromHtml(String html) {
        String source = String.valueOf(html);
        String title = extractTitle(source);
        String titleCandidate = candidateFromLegoText(title);
        if (titleCandidate != null) return titleCandidate;

        String lower = source.toLowerCase(Locale.ROOT);
        if (lower.contains("lego")) {
            String jsonCandidate = firstMatch(JSON_PRODUCT_PATTERN, source, true);
            if (jsonCandidate != null) return jsonCandidate;
        }

        String ean = firstMatch(EAN_PATTERN, source, false);
        if (ean != null) return ean;

        int limit = Math.min(source.length(), 300_000);
        String plain = TAG_PATTERN.matcher(source.substring(0, limit)).replaceAll(" ");
        return candidateFromLegoText(decodeEntities(plain));
    }

    private static String candidateFromLegoText(String text) {
        if (text == null || !text.toLowerCase(Locale.ROOT).contains("lego")) return null;
        String explicit = firstMatch(EXPLICIT_SET_PATTERN, text, true);
        return explicit != null ? explicit : bestSetNumber(text);
    }

    private static String bestSetNumber(String text) {
        Matcher matcher = NUMBER_PATTERN.matcher(text);
        while (matcher.find()) {
            String candidate = matcher.group(1);
            int number = Integer.parseInt(candidate);
            if (candidate.length() == 4 && number >= 1900 && number <= 2099) {
                continue;
            }
            return candidate;
        }
        return null;
    }

    private static String firstMatch(Pattern pattern, String text, boolean rejectYears) {
        Matcher matcher = pattern.matcher(text);
        while (matcher.find()) {
            String candidate = matcher.group(1);
            if (rejectYears && candidate.length() == 4) {
                int value = Integer.parseInt(candidate);
                if (value >= 1900 && value <= 2099) continue;
            }
            return candidate;
        }
        return null;
    }

    private static String extractTitle(String html) {
        Matcher matcher = TITLE_PATTERN.matcher(String.valueOf(html));
        if (!matcher.find()) return "";
        return normalize(decodeEntities(TAG_PATTERN.matcher(matcher.group(1)).replaceAll(" ")), 200);
    }

    private static String decodeEntities(String value) {
        return String.valueOf(value)
                .replace("&amp;", "&")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'")
                .replace("&nbsp;", " ")
                .replace("&lt;", "<")
                .replace("&gt;", ">");
    }

    private static String normalize(String value, int maxLength) {
        String clean = String.valueOf(value == null ? "" : value)
                .replace('\u00a0', ' ')
                .replaceAll("\\s+", " ")
                .trim();
        return clean.length() <= maxLength ? clean : clean.substring(0, maxLength).trim();
    }

    private static String download(String rawUrl) throws Exception {
        URI current = URI.create(rawUrl);
        for (int redirect = 0; redirect < 5; redirect++) {
            validatePublicHttps(current);
            HttpURLConnection connection = (HttpURLConnection) new URL(current.toString()).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(15_000);
            connection.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36");
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml");
            connection.setRequestProperty("Accept-Language", "de-DE,de;q=0.9,en;q=0.7");

            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.trim().isEmpty()) {
                    throw new IllegalStateException("Weiterleitung ohne Ziel");
                }
                current = current.resolve(location);
                continue;
            }
            if (status < 200 || status >= 400) {
                connection.disconnect();
                throw new IllegalStateException("HTTP " + status);
            }

            try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16_384];
                int total = 0;
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    total += read;
                    if (total > MAX_HTML_BYTES) throw new IllegalStateException("Seite zu groß");
                    output.write(buffer, 0, read);
                }
                return output.toString(StandardCharsets.UTF_8.name());
            } finally {
                connection.disconnect();
            }
        }
        throw new IllegalStateException("Zu viele Weiterleitungen");
    }

    private static void validatePublicHttps(URI uri) throws Exception {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
            throw new IllegalArgumentException("Nur öffentliche HTTPS-Links werden unterstützt.");
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (host.equals("localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
            throw new IllegalArgumentException("Lokale Adressen werden nicht geöffnet.");
        }
        for (InetAddress address : InetAddress.getAllByName(host)) {
            if (address.isAnyLocalAddress() || address.isLoopbackAddress() ||
                    address.isLinkLocalAddress() || address.isSiteLocalAddress()) {
                throw new IllegalArgumentException("Lokale Adressen werden nicht geöffnet.");
            }
        }
    }
}
