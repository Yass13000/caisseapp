package com.project1.app;

import android.annotation.SuppressLint;
import android.app.Presentation;
import android.content.Context;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Écran client (second écran) des caisses Android à double écran.
 *
 * Comme sous Windows : la page « #/ecran-client » de la caisse est ouverte en plein écran
 * sur l'écran secondaire (API Presentation d'Android) et reçoit le panier en direct.
 *   - update(state) : la caisse envoie l'état du panier ; il est gardé ici et transmis à la page
 *     (événement « caisse-cd-state »). La page le relit aussi au chargement (getState()).
 *   - configChanged() : les réglages (fond, pubs) ont changé → événement « caisse-cd-config ».
 *   - open(url) / close() : affichage voulu ou non ; suit les branchements / débranchements.
 * Sans écran secondaire, rien ne s'affiche et rien ne change pour la caisse.
 */
@CapacitorPlugin(name = "CustomerDisplay")
public class CustomerDisplayPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private DisplayManager displayManager;
    private Presentation presentation;
    private WebView screenWeb;
    private volatile String lastState = "null";
    private String url;
    private boolean wanted = false;

    private final DisplayManager.DisplayListener displayListener = new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int displayId) { main.postDelayed(CustomerDisplayPlugin.this::sync, 800); }
        @Override public void onDisplayRemoved(int displayId) { main.postDelayed(CustomerDisplayPlugin.this::sync, 300); }
        @Override public void onDisplayChanged(int displayId) { }
    };

    /** Lecture de l'état par la page de l'écran client (au chargement) */
    public class Bridge {
        @JavascriptInterface
        public String getState() { return lastState; }
    }

    @Override
    public void load() {
        displayManager = (DisplayManager) getContext().getSystemService(Context.DISPLAY_SERVICE);
        if (displayManager != null) displayManager.registerDisplayListener(displayListener, main);
    }

    @Override
    protected void handleOnDestroy() {
        if (displayManager != null) displayManager.unregisterDisplayListener(displayListener);
        main.post(this::dismiss);
    }

    private Display pickDisplay() {
        if (displayManager == null) return null;
        Display[] displays = displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        return displays != null && displays.length > 0 ? displays[0] : null;
    }

    @PluginMethod
    public void status(PluginCall call) {
        Display[] displays = displayManager != null
                ? displayManager.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION)
                : new Display[0];
        JSObject ret = new JSObject();
        ret.put("displays", displays == null ? 1 : displays.length + 1);
        ret.put("open", presentation != null && presentation.isShowing());
        call.resolve(ret);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String u = call.getString("url");
        if (u != null && u.startsWith("https://")) url = u;
        wanted = true;
        main.post(this::sync);
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        wanted = false;
        main.post(this::dismiss);
        call.resolve();
    }

    @PluginMethod
    public void update(PluginCall call) {
        JSObject state = call.getObject("state");
        lastState = state != null ? state.toString() : "null";
        push("caisse-cd-state", lastState);
        call.resolve();
    }

    @PluginMethod
    public void configChanged(PluginCall call) {
        push("caisse-cd-config", "null");
        call.resolve();
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        main.post(() -> { if (screenWeb != null && url != null) screenWeb.loadUrl(url); });
        call.resolve();
    }

    private void push(String event, String json) {
        main.post(() -> {
            if (screenWeb == null) return;
            screenWeb.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('" + event + "',{detail:" + json + "}));", null);
        });
    }

    private void dismiss() {
        if (presentation != null) {
            try { presentation.dismiss(); } catch (Exception ignored) { }
        }
        if (screenWeb != null) {
            try { screenWeb.destroy(); } catch (Exception ignored) { }
        }
        presentation = null;
        screenWeb = null;
    }

    private void sync() {
        Display target = wanted && url != null && getActivity() != null ? pickDisplay() : null;
        if (target == null) { dismiss(); return; }
        if (presentation != null && presentation.isShowing() && presentation.getDisplay().getDisplayId() == target.getDisplayId()) return;
        dismiss();
        try {
            presentation = new ScreenPresentation(getActivity(), target);
            presentation.setOnDismissListener(d -> { if (presentation == d) { presentation = null; screenWeb = null; } });
            presentation.show();
            giveFocusBackToCaisse();
        } catch (WindowManager.InvalidDisplayException e) {
            presentation = null;
            screenWeb = null;
        } catch (Exception e) {
            dismiss();
        }
    }

    /** Rend le focus (et donc le clavier) à la caisse après l'affichage de l'écran client */
    private void giveFocusBackToCaisse() {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().requestFocus();
        } catch (Exception ignored) { }
    }

    private class ScreenPresentation extends Presentation {
        ScreenPresentation(Context outer, Display display) { super(outer, display); }

        @SuppressLint("SetJavaScriptEnabled")
        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            Window w = getWindow();
            if (w != null) {
                w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                // L'écran client ne doit jamais prendre le focus clavier : sinon Android ouvre le
                // clavier sur l'écran secondaire et il n'apparaît plus sur la caisse.
                w.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
                w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
            WebView web = new WebView(getContext());
            web.setBackgroundColor(Color.BLACK);
            web.setFocusable(false);
            web.setFocusableInTouchMode(false);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setUseWideViewPort(true);
            s.setLoadWithOverviewMode(true);
            s.setSupportZoom(false);
            web.addJavascriptInterface(new Bridge(), "CaisseCustomerDisplayNative");
            web.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    // Seule la caisse s'affiche sur l'écran client
                    String target = request.getUrl().toString();
                    return url == null || !target.startsWith(url.split("#")[0]);
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    // Pas de réseau : nouvel essai dans 15 s
                    if (request.isForMainFrame()) main.postDelayed(() -> {
                        if (screenWeb == view && url != null) view.loadUrl(url);
                    }, 15000);
                }
            });
            setContentView(web, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            screenWeb = web;
            web.loadUrl(url);
        }
    }
}
