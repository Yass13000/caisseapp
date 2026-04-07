package com.project1.app;

import android.content.Context;
import com.epson.epos2.Epos2Exception;
import com.epson.epos2.printer.Printer;
import com.epson.epos2.printer.PrinterStatusInfo;
import com.epson.epos2.printer.ReceiveListener;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "EpsonPrinter")
public class EpsonPrinterPlugin extends Plugin implements ReceiveListener {

    private Printer mPrinter = null;

    @PluginMethod
    public void printOrder(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String ipAddress = call.getString("ip", "").trim();
                String orderId = call.getString("orderId", "#000");
                String total = call.getString("total", "0.00");
                String itemsJsonString = call.getString("items", "[]");
                String paymentStatus = call.getString("paymentStatus", ""); // <-- RECUPERATION DU STATUT

                if (ipAddress.isEmpty()) {
                    call.reject("L'adresse IP de l'imprimante est vide.");
                    return;
                }

                mPrinter = new Printer(Printer.TM_M30II, Printer.MODEL_ANK, getContext());
                mPrinter.setReceiveEventListener(this);

                // --- 1. EN-TÊTE : FOND NOIR, TEXTE BLANC ---
                mPrinter.addTextAlign(Printer.ALIGN_CENTER);
                mPrinter.addFeedLine(1);

                // Activation du mode inversé (Reverse video = TRUE)
                mPrinter.addTextStyle(Printer.TRUE, Printer.FALSE, Printer.FALSE, Printer.COLOR_1);
                mPrinter.addTextSize(2, 2);
                mPrinter.addText(" N° " + orderId + " \n");

                // Désactivation immédiate du mode inversé
                mPrinter.addTextStyle(Printer.FALSE, Printer.FALSE, Printer.FALSE, Printer.COLOR_1);
                mPrinter.addTextSize(1, 1);
                mPrinter.addFeedLine(1);
                mPrinter.addText("------------------------------------------\n");

                // --- 2. CORPS : RECAPITULATIF (PETIT) ---
                mPrinter.addTextAlign(Printer.ALIGN_LEFT);
                mPrinter.addTextSize(1, 1);

                try {
                    JSONArray itemsArray = new JSONArray(itemsJsonString);
                    for (int i = 0; i < itemsArray.length(); i++) {
                        JSONObject item = itemsArray.getJSONObject(i);
                        int quantity = item.optInt("quantity", 1);

                        JSONObject product = item.optJSONObject("product");
                        String productName = product != null ? product.optString("name", "Produit") : "Produit Inconnu";

                        mPrinter.addText(quantity + "x " + productName + "\n");

                        if (item.has("boisson") && !item.isNull("boisson")) {
                            JSONObject boisson = item.getJSONObject("boisson");
                            String boissonName = boisson.optString("name", "");
                            if (!boissonName.isEmpty()) mPrinter.addText("   + " + boissonName + "\n");
                        }

                        if (item.has("accompagnement") && !item.isNull("accompagnement")) {
                            JSONObject acc = item.getJSONObject("accompagnement");
                            String accName = acc.optString("name", "");
                            if (!accName.isEmpty()) mPrinter.addText("   + " + accName + "\n");
                        }
                    }
                } catch (Exception e) {
                    mPrinter.addText("Erreur de lecture des articles\n");
                }

                // --- 3. TOTAL : EN GRAND ---
                mPrinter.addFeedLine(1);
                mPrinter.addText("------------------------------------------\n");
                mPrinter.addTextAlign(Printer.ALIGN_RIGHT);
                mPrinter.addTextSize(2, 2);
                mPrinter.addText("TOTAL : " + total + " EUR\n");

                // --- 4. STATUT DU PAIEMENT ---
                mPrinter.addFeedLine(1);
                mPrinter.addTextAlign(Printer.ALIGN_CENTER);
                mPrinter.addTextSize(2, 2);
                mPrinter.addText("=== " + paymentStatus + " ===\n"); // Va imprimer === PAYÉ === ou === NON PAYÉ ===

                // On remet la taille normale avant de continuer
                mPrinter.addTextSize(1, 1);
                mPrinter.addFeedLine(2);

                // --- 5. QR CODE ---
                mPrinter.addTextAlign(Printer.ALIGN_CENTER);
                mPrinter.addSymbol("https://votre-site.com/recu/" + orderId, Printer.SYMBOL_QRCODE_MODEL_2, Printer.LEVEL_L, 8, 8, 0);
                mPrinter.addFeedLine(2);
                mPrinter.addCut(Printer.CUT_FEED);

                // --- CONNEXION ---
                new Thread(() -> {
                    try {
                        mPrinter.connect("TCP:" + ipAddress, Printer.PARAM_DEFAULT);
                        mPrinter.sendData(Printer.PARAM_DEFAULT);
                        call.resolve();
                    } catch (Epos2Exception e) {
                        if (mPrinter != null) mPrinter.clearCommandBuffer();
                        call.reject("Echec connexion IP. Code Epson : " + e.getErrorStatus());
                    } catch (Exception e) {
                        call.reject("Erreur reseau inattendue : " + e.getMessage());
                    }
                }).start();

            } catch (Epos2Exception e) {
                call.reject("Erreur creation imprimante. Code Epson : " + e.getErrorStatus());
            } catch (Exception e) {
                call.reject("Crash Java inattendu : " + e.getMessage());
            }
        });
    }

    @Override
    public void onPtrReceive(Printer printerObj, int code, PrinterStatusInfo status, String printJobId) {
        new Thread(() -> {
            try {
                printerObj.disconnect();
            } catch (Epos2Exception e) {
                e.printStackTrace();
            }
        }).start();
    }
}