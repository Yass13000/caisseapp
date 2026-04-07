package com.project1.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // --- LA LIGNE MAGIQUE QUI RÉPARE L'ERREUR "UNIMPLEMENTED" ---
        registerPlugin(EpsonPrinterPlugin.class);

        super.onCreate(savedInstanceState);

        // 1. Force le mode Immersif (Plein écran total sans barres Android)
        hideSystemUI();
    }

    @Override
    public void onStart() {
        super.onStart();

        // 2. Configuration de la WebView pour empêcher le zoom automatique
        // et forcer le respect du ratio 1080x1920
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebSettings settings = this.bridge.getWebView().getSettings();
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemUI();
    }

    // --- AJOUT : Force la disparition des boutons à chaque fois que l'app reprend le focus ---
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
        }
    }

    private void hideSystemUI() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
        );
    }
}