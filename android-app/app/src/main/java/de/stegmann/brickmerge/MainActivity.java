package de.stegmann.brickmerge;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.SearchManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    static final String EXTRA_INPUT = "de.stegmann.brickmerge.INPUT";
    private static final String HOME_URL = "https://www.brickmerge.de/";
    private static final String APP_ASSET_PREFIX = "/__brickmerge_app/";
    private static final String RUNTIME_LOADER = "(() => {" +
            "if (window.__bmAppRuntimeLoading) return;" +
            "window.__bmAppRuntimeLoading = true;" +
            "const boot = document.createElement('script');" +
            "boot.src = '/__brickmerge_app/webview-bootstrap.js?v=1';" +
            "boot.onload = () => {" +
            "const runtime = document.createElement('script');" +
            "runtime.src = '/__brickmerge_app/brickmerge-runtime.js?v=1';" +
            "document.documentElement.appendChild(runtime);" +
            "};" +
            "document.documentElement.appendChild(boot);" +
            "})();";

    private final ExecutorService resolverExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private NativeBridge nativeBridge;
    private ProgressBar pageProgress;
    private TextView statusView;
    private EditText searchInput;
    private int resolveGeneration;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        createUi();
        configureBackNavigation();

        boolean restored = state != null && webView.restoreState(state) != null;
        String incoming = extractInput(getIntent());
        if (!incoming.isEmpty()) {
            resolveAndSearch(incoming);
        } else if (!restored) {
            webView.loadUrl(HOME_URL);
        }
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(10), dp(8), dp(10), dp(8));
        toolbar.setBackgroundColor(Color.rgb(250, 250, 250));

        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.ic_launcher);
        icon.setContentDescription(null);
        toolbar.addView(icon, new LinearLayout.LayoutParams(dp(40), dp(40)));

        searchInput = new EditText(this);
        searchInput.setSingleLine(true);
        searchInput.setHint(R.string.search_hint);
        searchInput.setTextSize(15);
        searchInput.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(0, dp(48), 1f);
        inputParams.setMargins(dp(8), 0, dp(8), 0);
        toolbar.addView(searchInput, inputParams);

        Button searchButton = new Button(this);
        searchButton.setText(R.string.search_action);
        searchButton.setTextColor(Color.WHITE);
        searchButton.setTextSize(14);
        searchButton.setAllCaps(false);
        searchButton.setBackgroundResource(R.drawable.search_button_background);
        toolbar.addView(searchButton, new LinearLayout.LayoutParams(dp(82), dp(44)));
        root.addView(toolbar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        FrameLayout browser = new FrameLayout(this);
        webView = new WebView(this);
        pageProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        pageProgress.setMax(100);
        statusView = new TextView(this);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(dp(24), dp(18), dp(24), dp(18));
        statusView.setTextColor(Color.DKGRAY);
        statusView.setBackgroundColor(Color.rgb(245, 245, 245));
        statusView.setVisibility(View.GONE);

        browser.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        browser.addView(statusView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        browser.addView(pageProgress, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(3)
        ));
        root.addView(browser, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
        ));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        settings.setUserAgentString(settings.getUserAgentString() + " BrickmergeApp/1.0");

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        nativeBridge = new NativeBridge(this, webView);
        webView.addJavascriptInterface(nativeBridge, "BrickmergeNative");
        webView.setWebViewClient(createWebViewClient());
        webView.setWebChromeClient(createWebChromeClient());
        webView.setDownloadListener(createDownloadListener());

        View.OnClickListener submit = ignored -> submitSearch();
        searchButton.setOnClickListener(submit);
        searchInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId != EditorInfo.IME_ACTION_SEARCH) return false;
            submitSearch();
            return true;
        });

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets status = insets.getInsets(WindowInsets.Type.statusBars());
                android.graphics.Insets navigation = insets.getInsets(WindowInsets.Type.navigationBars());
                view.setPadding(status.left, status.top, status.right, navigation.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(root);
    }

    private WebViewClient createWebViewClient() {
        return new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (request.isForMainFrame() && isBrickmerge(uri)) return false;
                if (request.isForMainFrame()) openExternally(uri);
                return request.isForMainFrame();
            }

            @Override public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
            ) {
                Uri uri = request.getUrl();
                if (!isBrickmerge(uri) || !uri.getPath().startsWith(APP_ASSET_PREFIX)) {
                    return null;
                }
                String file = uri.getLastPathSegment();
                if (!"webview-bootstrap.js".equals(file) && !"brickmerge-runtime.js".equals(file)) {
                    return null;
                }
                try {
                    return new WebResourceResponse(
                            "application/javascript",
                            "UTF-8",
                            getAssets().open(file)
                    );
                } catch (IOException ignored) {
                    return null;
                }
            }

            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                pageProgress.setVisibility(View.VISIBLE);
                hideStatus();
            }

            @Override public void onPageCommitVisible(WebView view, String url) {
                if (isBrickmerge(Uri.parse(url))) injectRuntime();
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (isBrickmerge(Uri.parse(url))) injectRuntime();
            }

            @Override public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
            ) {
                if (request.isForMainFrame()) showStatus(getString(R.string.page_error));
            }
        };
    }

    private WebChromeClient createWebChromeClient() {
        return new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                pageProgress.setProgress(progress);
                pageProgress.setVisibility(progress < 100 ? View.VISIBLE : View.GONE);
            }

            @Override public boolean onCreateWindow(
                    WebView view,
                    boolean isDialog,
                    boolean isUserGesture,
                    Message resultMsg
            ) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(
                            WebView child,
                            WebResourceRequest request
                    ) {
                        if (Boolean.TRUE.equals(child.getTag())) return true;
                        child.setTag(Boolean.TRUE);
                        openExternally(request.getUrl());
                        child.destroy();
                        return true;
                    }

                    @Override public void onPageStarted(WebView child, String url, Bitmap favicon) {
                        if (Boolean.TRUE.equals(child.getTag())) return;
                        Uri uri = Uri.parse(url);
                        if ("http".equalsIgnoreCase(uri.getScheme()) ||
                                "https".equalsIgnoreCase(uri.getScheme())) {
                            child.setTag(Boolean.TRUE);
                            openExternally(uri);
                            child.stopLoading();
                            child.destroy();
                        }
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        };
    }

    private DownloadListener createDownloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) ->
                openExternally(Uri.parse(url));
    }

    private void submitSearch() {
        String query = searchInput.getText().toString().replaceAll("\\s+", " ").trim();
        if (query.isEmpty()) {
            searchInput.setError(getString(R.string.search_required));
            return;
        }
        resolveAndSearch(query);
    }

    private void resolveAndSearch(String rawInput) {
        String input = String.valueOf(rawInput).replaceAll("\\s+", " ").trim();
        if (input.isEmpty()) return;
        searchInput.setText(input);
        searchInput.setSelection(searchInput.length());
        hideKeyboard();

        if (InputResolver.extractHttpUrl(input) == null) {
            loadSearch(input);
            return;
        }

        int generation = ++resolveGeneration;
        showStatus(getString(R.string.resolving_url));
        resolverExecutor.execute(() -> {
            InputResolver.Result result;
            try {
                result = InputResolver.resolve(input);
            } catch (Exception ignored) {
                result = new InputResolver.Result(input, true);
            }
            InputResolver.Result resolved = result;
            runOnUiThread(() -> {
                if (generation != resolveGeneration || isFinishing()) return;
                if (resolved.fallback) {
                    Toast.makeText(this, R.string.url_fallback, Toast.LENGTH_LONG).show();
                }
                loadSearch(resolved.query);
            });
        });
    }

    private void loadSearch(String query) {
        resolveGeneration++;
        String clean = String.valueOf(query).replaceAll("\\s+", " ").trim();
        searchInput.setText(clean);
        searchInput.setSelection(searchInput.length());
        hideStatus();
        Uri target = Uri.parse(HOME_URL).buildUpon().appendQueryParameter("find", clean).build();
        webView.loadUrl(target.toString());
    }

    private void injectRuntime() {
        webView.evaluateJavascript(RUNTIME_LOADER, null);
    }

    private String extractInput(Intent intent) {
        if (intent == null) return "";
        String extra = intent.getStringExtra(EXTRA_INPUT);
        if (extra != null && !extra.trim().isEmpty()) {
            intent.removeExtra(EXTRA_INPUT);
            return extra.trim();
        }
        if (Intent.ACTION_SEARCH.equals(intent.getAction())) {
            String query = intent.getStringExtra(SearchManager.QUERY);
            return query == null ? "" : query.trim();
        }
        Uri data = intent.getData();
        if (data != null && "brickmerge".equalsIgnoreCase(data.getScheme())) {
            String query = data.getQueryParameter("q");
            return query == null ? "" : query.trim();
        }
        return "";
    }

    private void showStatus(String text) {
        statusView.setText(text);
        statusView.setVisibility(View.VISIBLE);
    }

    private void hideStatus() {
        statusView.setVisibility(View.GONE);
    }

    private void hideKeyboard() {
        InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (keyboard != null) keyboard.hideSoftInputFromWindow(searchInput.getWindowToken(), 0);
        searchInput.clearFocus();
    }

    private static boolean isBrickmerge(Uri uri) {
        String host = uri.getHost();
        return "https".equalsIgnoreCase(uri.getScheme()) && host != null &&
                (host.equalsIgnoreCase("brickmerge.de") ||
                        host.toLowerCase(Locale.ROOT).endsWith(".brickmerge.de"));
    }

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, R.string.open_external_failed, Toast.LENGTH_LONG).show();
        }
    }

    private void configureBackNavigation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::handleBack
            );
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String input = extractInput(intent);
        if (!input.isEmpty()) resolveAndSearch(input);
    }

    @SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() {
        handleBack();
    }

    private void handleBack() {
        if (webView.canGoBack()) webView.goBack();
        else finish();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override protected void onDestroy() {
        resolverExecutor.shutdownNow();
        nativeBridge.destroy();
        webView.removeJavascriptInterface("BrickmergeNative");
        webView.destroy();
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
