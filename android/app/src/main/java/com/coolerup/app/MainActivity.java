package com.coolerup.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Coolerup Android shell.
 *
 * The WebView Capacitor creates is {@code android.webkit.WebView} — Chromium,
 * the same engine Chrome and Edge use. We do not ship a separate engine; we
 * only brand the User-Agent so sites see "Coolerup Browser" while still
 * receiving the Chrome feature set (the same approach Edge takes with Edg/…).
 *
 * The value below mirrors NATIVE_WEBVIEW_USER_AGENT in
 * src/lib/browserEngine.ts. capacitor.config.ts also appends
 * "CoolerupBrowser/1.0" through {@code android.appendUserAgent}; this override
 * covers the in-app browser WebView as well.
 */
public class MainActivity extends BridgeActivity {

    private static final String COOLERUP_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "CoolerupBrowser/1.0 Chrome/120.0.0.0 Mobile Safari/537.36";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().getSettings().setUserAgentString(COOLERUP_USER_AGENT);
        }
    }
}
