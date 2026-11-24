package com.project1.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Imprimantes ticket de la caisse Android, comme sur Windows :
 *  - recherche : USB (classe imprimante ou marque connue) + réseau (annonces mDNS et balayage du port 9100),
 *    nom du modèle lu sur l'annonce ou la page web de l'imprimante ;
 *  - impression : le ticket HTML (le même que sur Windows) est dessiné dans une WebView à la résolution
 *    de la tête (203 dpi), converti en noir et blanc puis envoyé en ESC/POS (image, avance, coupe) ;
 *  - envoi brut (tiroir-caisse).
 * Cible : "usb:VVVV:PPPP[:n]" ou "tcp:IP:PORT".
 */
@CapacitorPlugin(name = "CaissePrinter")
public class CaissePrinterPlugin extends Plugin {

    private static final String ACTION_USB_PERMISSION = "com.project1.caisse.USB_PERMISSION";
    private static final int DPI = 203;
    private static final int RAW_PORT = 9100;

    /** Marques d'imprimantes ticket courantes (identifiant fabricant USB) */
    private static final Map<Integer, String> VENDORS = new HashMap<>();
    static {
        VENDORS.put(0x04b8, "EPSON");
        VENDORS.put(0x0519, "Star");
        VENDORS.put(0x1504, "Bixolon");
        VENDORS.put(0x0dd4, "Custom");
        VENDORS.put(0x154f, "SNBC");
        VENDORS.put(0x20d1, "Rongta");
        VENDORS.put(0x0416, "Xprinter");
        VENDORS.put(0x0483, "POS");
        VENDORS.put(0x1fc9, "POS");
        VENDORS.put(0x0fe6, "POS");
        VENDORS.put(0x28e9, "POS");
        VENDORS.put(0x6868, "POS");
        VENDORS.put(0x1659, "POS");
        VENDORS.put(0x0525, "POS");
        VENDORS.put(0x0493, "Citizen");
        VENDORS.put(0x1d90, "Citizen");
        VENDORS.put(0x0922, "Dymo");
        VENDORS.put(0x0a5f, "Zebra");
        VENDORS.put(0x2730, "Citizen");
        VENDORS.put(0x0b00, "Sewoo");
        VENDORS.put(0x0471, "POS");
        VENDORS.put(0x4b43, "POS");
    }

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Object usbLock = new Object();
    private final Object renderLock = new Object();

    // ─────────────────────────────── Recherche ───────────────────────────────

    @PluginMethod
    public void discover(PluginCall call) {
        final boolean network = call.getBoolean("network", true);
        final int timeoutMs = Math.max(1500, Math.min(10000, call.getInt("timeoutMs", 3500)));
        io.execute(() -> {
            JSArray out = new JSArray();
            try {
                for (JSObject p : listUsb()) out.put(p);
                if (network) for (JSObject p : listNetwork(timeoutMs)) out.put(p);
                JSObject ret = new JSObject();
                ret.put("printers", out);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Recherche impossible : " + e.getMessage());
            }
        });
    }

    private List<JSObject> listUsb() {
        List<JSObject> list = new ArrayList<>();
        UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (um == null) return list;
        Map<String, Integer> seen = new HashMap<>();
        for (UsbDevice d : sortedDevices(um)) {
            if (!looksLikePrinter(d) || bulkOut(d) == null) continue;
            String base = String.format(Locale.ROOT, "usb:%04x:%04x", d.getVendorId(), d.getProductId());
            int n = seen.containsKey(base) ? seen.get(base) + 1 : 1;
            seen.put(base, n);
            JSObject p = new JSObject();
            p.put("id", n == 1 ? base : base + ":" + n);
            p.put("type", "usb");
            p.put("model", usbName(d));
            p.put("permission", um.hasPermission(d));
            list.add(p);
        }
        return list;
    }

    private List<UsbDevice> sortedDevices(UsbManager um) {
        List<UsbDevice> devs = new ArrayList<>(um.getDeviceList().values());
        Collections.sort(devs, (a, b) -> a.getDeviceName().compareTo(b.getDeviceName()));
        return devs;
    }

    private boolean looksLikePrinter(UsbDevice d) {
        if (d.getDeviceClass() == UsbConstants.USB_CLASS_PRINTER) return true;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            if (d.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return true;
        }
        if (!VENDORS.containsKey(d.getVendorId())) return false;
        // Marque connue : on écarte les claviers / lecteurs (HID) et les stockages
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            int c = d.getInterface(i).getInterfaceClass();
            if (c == UsbConstants.USB_CLASS_VENDOR_SPEC || c == UsbConstants.USB_CLASS_CDC_DATA) return true;
        }
        return false;
    }

    private String usbName(UsbDevice d) {
        String brand = VENDORS.get(d.getVendorId());
        String m = null, p = null;
        try { m = d.getManufacturerName(); } catch (Exception ignored) { }
        try { p = d.getProductName(); } catch (Exception ignored) { }
        m = clean(m); p = clean(p);
        String name;
        if (p != null && m != null && !p.toLowerCase(Locale.ROOT).contains(m.toLowerCase(Locale.ROOT).split(" ")[0])) name = m + " " + p;
        else if (p != null) name = p;
        else if (m != null) name = m;
        else name = brand != null && !"POS".equals(brand) ? brand : "Imprimante USB";
        if (brand != null && !"POS".equals(brand) && !name.toUpperCase(Locale.ROOT).contains(brand.toUpperCase(Locale.ROOT))) name = brand + " " + name;
        return name;
    }

    private static String clean(String s) {
        if (s == null) return null;
        s = s.replaceAll("[\\p{Cntrl}]", "").trim().replaceAll("\\s+", " ");
        return s.isEmpty() ? null : s;
    }

    private List<JSObject> listNetwork(int timeoutMs) throws InterruptedException {
        final Map<String, String> names = new ConcurrentHashMap<>();   // ip -> nom annoncé
        final Set<String> open = Collections.synchronizedSet(new LinkedHashSet<>());

        // 1. Annonces mDNS (Epson, Star… annoncent « _pdl-datastream._tcp » = port 9100)
        NsdBrowser nsd = new NsdBrowser(names, open);
        nsd.start();

        // 2. Balayage du port 9100 sur le(s) réseau(x) local(aux) (Wi-Fi ou Ethernet)
        List<String> hosts = new ArrayList<>();
        for (String base : localSubnets()) {
            for (int i = 1; i < 255; i++) hosts.add(base + i);
        }
        ExecutorService pool = Executors.newFixedThreadPool(48);
        int connectMs = Math.min(450, Math.max(200, timeoutMs / 8));
        for (String h : hosts) {
            pool.execute(() -> { if (portOpen(h, RAW_PORT, connectMs)) open.add(h); });
        }
        pool.shutdown();
        pool.awaitTermination(timeoutMs, TimeUnit.MILLISECONDS);
        pool.shutdownNow();
        nsd.awaitAndStop(1500);

        // 3. Nom du modèle : annonce, sinon titre de sa page web
        List<String> ips = new ArrayList<>(open);
        Collections.sort(ips, (a, b) -> ipKey(a).compareTo(ipKey(b)));
        final Map<String, String> models = new ConcurrentHashMap<>();
        ExecutorService namePool = Executors.newFixedThreadPool(8);
        for (String ip : ips) {
            namePool.execute(() -> {
                String n = names.get(ip);
                if (n == null) n = httpTitle(ip);
                if (n != null) models.put(ip, n);
            });
        }
        namePool.shutdown();
        namePool.awaitTermination(2500, TimeUnit.MILLISECONDS);
        namePool.shutdownNow();

        List<JSObject> list = new ArrayList<>();
        for (String ip : ips) {
            JSObject p = new JSObject();
            p.put("id", "tcp:" + ip + ":" + RAW_PORT);
            p.put("type", "network");
            p.put("ip", ip);
            p.put("port", RAW_PORT);
            String m = models.get(ip);
            if (m != null) p.put("model", m);
            list.add(p);
        }
        return list;
    }

    private static String ipKey(String ip) {
        StringBuilder sb = new StringBuilder();
        for (String part : ip.split("\\.")) sb.append(String.format(Locale.ROOT, "%03d", Integer.parseInt(part)));
        return sb.toString();
    }

    /** Préfixes « a.b.c. » des réseaux IPv4 de l'appareil (un /24 balayé par réseau) */
    private List<String> localSubnets() {
        Set<String> out = new LinkedHashSet<>();
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                for (Network n : cm.getAllNetworks()) {
                    LinkProperties lp = cm.getLinkProperties(n);
                    if (lp == null) continue;
                    for (LinkAddress la : lp.getLinkAddresses()) {
                        InetAddress a = la.getAddress();
                        if (a instanceof Inet4Address && !a.isLoopbackAddress() && a.isSiteLocalAddress()) {
                            String ip = a.getHostAddress();
                            out.add(ip.substring(0, ip.lastIndexOf('.') + 1));
                        }
                    }
                }
            }
        } catch (Exception ignored) { }
        return new ArrayList<>(out);
    }

    private static boolean portOpen(String host, int port, int timeoutMs) {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(host, port), timeoutMs);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String httpTitle(String ip) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://" + ip + "/").openConnection();
            c.setConnectTimeout(700);
            c.setReadTimeout(900);
            c.setInstanceFollowRedirects(true);
            InputStream in = c.getInputStream();
            byte[] buf = new byte[8192];
            int len = 0, r;
            while (len < buf.length && (r = in.read(buf, len, buf.length - len)) > 0) len += r;
            String html = new String(buf, 0, len, StandardCharsets.ISO_8859_1);
            Matcher m = Pattern.compile("<title[^>]*>([^<]{2,80})</title>", Pattern.CASE_INSENSITIVE).matcher(html);
            if (m.find()) {
                String t = clean(m.group(1).replaceAll("&amp;", "&"));
                if (t != null && !t.matches("(?i).*(login|index|home|welcome|404|error|untitled).*")) return t;
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.disconnect();
        }
        return null;
    }

    /** Écoute des annonces mDNS d'imprimantes, résolues une par une */
    private class NsdBrowser {
        private final Map<String, String> names;
        private final Set<String> open;
        private final NsdManager nm;
        private final List<NsdManager.DiscoveryListener> listeners = new ArrayList<>();
        private final List<NsdServiceInfo> queue = Collections.synchronizedList(new ArrayList<>());
        private final AtomicBoolean resolving = new AtomicBoolean(false);
        private final AtomicBoolean stopped = new AtomicBoolean(false);

        NsdBrowser(Map<String, String> names, Set<String> open) {
            this.names = names;
            this.open = open;
            this.nm = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        }

        void start() {
            if (nm == null) return;
            for (String type : new String[]{"_pdl-datastream._tcp", "_printer._tcp"}) {
                NsdManager.DiscoveryListener l = new NsdManager.DiscoveryListener() {
                    public void onStartDiscoveryFailed(String t, int e) { }
                    public void onStopDiscoveryFailed(String t, int e) { }
                    public void onDiscoveryStarted(String t) { }
                    public void onDiscoveryStopped(String t) { }
                    public void onServiceLost(NsdServiceInfo s) { }
                    public void onServiceFound(NsdServiceInfo s) { queue.add(s); next(); }
                };
                try {
                    nm.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, l);
                    listeners.add(l);
                } catch (Exception ignored) { }
            }
        }

        private void next() {
            if (stopped.get() || queue.isEmpty() || !resolving.compareAndSet(false, true)) return;
            NsdServiceInfo s = queue.remove(0);
            try {
                nm.resolveService(s, new NsdManager.ResolveListener() {
                    public void onResolveFailed(NsdServiceInfo i, int e) { resolving.set(false); next(); }
                    public void onServiceResolved(NsdServiceInfo i) {
                        InetAddress h = i.getHost();
                        if (h instanceof Inet4Address) {
                            String ip = h.getHostAddress();
                            String n = clean(i.getServiceName());
                            if (n != null && !names.containsKey(ip)) names.put(ip, n);
                            if (i.getPort() == RAW_PORT) open.add(ip);
                        }
                        resolving.set(false);
                        next();
                    }
                });
            } catch (Exception e) {
                resolving.set(false);
            }
        }

        void awaitAndStop(long ms) throws InterruptedException {
            long end = System.currentTimeMillis() + Math.max(0, ms);
            while (System.currentTimeMillis() < end && (!queue.isEmpty() || resolving.get())) Thread.sleep(100);
            stopped.set(true);
            for (NsdManager.DiscoveryListener l : listeners) {
                try { nm.stopServiceDiscovery(l); } catch (Exception ignored) { }
            }
        }
    }

    // ─────────────────────────────── Impression ───────────────────────────────

    /** { target, html, dots (384 | 576), copies, cut } : ticket HTML imprimé en image */
    @PluginMethod
    public void printHtml(PluginCall call) {
        final String target = call.getString("target", "");
        final String html = call.getString("html", "");
        final int dots = call.getInt("dots", 576) <= 384 ? 384 : 576;
        final int copies = Math.max(1, Math.min(5, call.getInt("copies", 1)));
        final boolean cut = call.getBoolean("cut", true);
        if (target.isEmpty() || html.isEmpty()) { call.reject("Imprimante ou ticket manquant"); return; }
        io.execute(() -> {
            try {
                byte[] one;
                synchronized (renderLock) {
                    Bitmap bmp = render(html, dots);
                    Mono mono = toMono(bmp, dots);
                    bmp.recycle();
                    if (mono.black == 0) {
                        // WebView pas encore dessinée : on recommence une fois
                        bmp = render(html, dots);
                        mono = toMono(bmp, dots);
                        bmp.recycle();
                    }
                    if (mono.black == 0) throw new Exception("Ticket dessiné vide");
                    one = escPosImage(mono, dots, cut);
                }
                ByteArrayOutputStream all = new ByteArrayOutputStream();
                for (int i = 0; i < copies; i++) all.write(one);
                send(target, all.toByteArray());
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
                call.resolve(ret);
            }
        });
    }

    /** { target, base64 } : octets bruts (ex. ouverture du tiroir) */
    @PluginMethod
    public void sendRaw(PluginCall call) {
        final String target = call.getString("target", "");
        final String b64 = call.getString("base64", "");
        io.execute(() -> {
            JSObject ret = new JSObject();
            try {
                send(target, Base64.decode(b64, Base64.DEFAULT));
                ret.put("success", true);
            } catch (Exception e) {
                ret.put("success", false);
                ret.put("error", e.getMessage());
            }
            call.resolve(ret);
        });
    }

    /** { target } : vérifie que l'imprimante répond (USB branchée et autorisée, ou port 9100 ouvert) */
    @PluginMethod
    public void check(PluginCall call) {
        final String target = call.getString("target", "");
        io.execute(() -> {
            JSObject ret = new JSObject();
            try {
                if (target.startsWith("tcp:")) {
                    String[] p = target.split(":");
                    ret.put("ok", portOpen(p[1], p.length > 2 ? Integer.parseInt(p[2]) : RAW_PORT, 1500));
                } else {
                    ret.put("ok", findUsb(target) != null);
                }
            } catch (Exception e) {
                ret.put("ok", false);
            }
            call.resolve(ret);
        });
    }

    /** { target } : demande l'accès à une imprimante USB (fenêtre Android « Autoriser ») */
    @PluginMethod
    public void authorize(PluginCall call) {
        final String target = call.getString("target", "");
        io.execute(() -> {
            JSObject ret = new JSObject();
            try {
                UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
                UsbDevice d = findUsb(target);
                ret.put("granted", um != null && d != null && (um.hasPermission(d) || askPermission(um, d)));
            } catch (Exception e) {
                ret.put("granted", false);
            }
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void exitApp(PluginCall call) {
        call.resolve();
        Activity a = getActivity();
        if (a != null) a.runOnUiThread(a::finishAffinity);
    }

    private void send(String target, byte[] data) throws Exception {
        if (target.startsWith("tcp:")) {
            String[] p = target.split(":");
            int port = p.length > 2 ? Integer.parseInt(p[2]) : RAW_PORT;
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(p[1], port), 3000);
                s.setSoTimeout(15000);
                OutputStream out = s.getOutputStream();
                for (int off = 0; off < data.length; off += 8192) {
                    out.write(data, off, Math.min(8192, data.length - off));
                }
                out.flush();
                Thread.sleep(150);
            } catch (java.net.SocketTimeoutException | java.net.ConnectException e) {
                throw new Exception("Imprimante réseau injoignable (" + p[1] + ")");
            }
            return;
        }
        if (target.startsWith("usb:")) {
            sendUsb(target, data);
            return;
        }
        throw new Exception("Imprimante inconnue : " + target);
    }

    private UsbDevice findUsb(String target) {
        UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        if (um == null) return null;
        String[] p = target.split(":");
        if (p.length < 3) return null;
        int vid = Integer.parseInt(p[1], 16), pid = Integer.parseInt(p[2], 16);
        int nth = p.length > 3 ? Integer.parseInt(p[3]) : 1;
        int k = 0;
        for (UsbDevice d : sortedDevices(um)) {
            if (d.getVendorId() == vid && d.getProductId() == pid && bulkOut(d) != null && ++k == nth) return d;
        }
        return null;
    }

    private UsbInterfaceAndEndpoint bulkOut(UsbDevice d) {
        UsbInterfaceAndEndpoint fallback = null;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface itf = d.getInterface(i);
            for (int e = 0; e < itf.getEndpointCount(); e++) {
                UsbEndpoint ep = itf.getEndpoint(e);
                if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                    UsbInterfaceAndEndpoint r = new UsbInterfaceAndEndpoint(itf, ep);
                    if (itf.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER) return r;
                    if (fallback == null) fallback = r;
                }
            }
        }
        return fallback;
    }

    private static class UsbInterfaceAndEndpoint {
        final UsbInterface itf;
        final UsbEndpoint ep;
        UsbInterfaceAndEndpoint(UsbInterface itf, UsbEndpoint ep) { this.itf = itf; this.ep = ep; }
    }

    private void sendUsb(String target, byte[] data) throws Exception {
        synchronized (usbLock) {
            UsbManager um = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
            UsbDevice d = findUsb(target);
            if (um == null || d == null) throw new Exception("Imprimante USB débranchée");
            if (!um.hasPermission(d) && !askPermission(um, d)) throw new Exception("Accès à l'imprimante USB refusé");
            UsbInterfaceAndEndpoint ie = bulkOut(d);
            UsbDeviceConnection conn = um.openDevice(d);
            if (conn == null) throw new Exception("Imprimante USB occupée");
            try {
                if (!conn.claimInterface(ie.itf, true)) throw new Exception("Imprimante USB occupée");
                int chunk = Math.max(64, Math.min(16384, ie.ep.getMaxPacketSize() * 64));
                for (int off = 0; off < data.length; ) {
                    int len = Math.min(chunk, data.length - off);
                    int w = conn.bulkTransfer(ie.ep, data, off, len, 10000);
                    if (w <= 0) throw new Exception("L'imprimante USB ne répond pas (papier, capot ?)");
                    off += w;
                }
                conn.releaseInterface(ie.itf);
            } finally {
                conn.close();
            }
        }
    }

    @SuppressLint({"UnspecifiedRegisterReceiverFlag", "WrongConstant"})
    private boolean askPermission(UsbManager um, UsbDevice d) throws InterruptedException {
        final CountDownLatch latch = new CountDownLatch(1);
        final boolean[] granted = {false};
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                if (!ACTION_USB_PERMISSION.equals(i.getAction())) return;
                granted[0] = i.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                latch.countDown();
            }
        };
        Context ctx = getContext();
        ContextCompat.registerReceiver(ctx, r, new IntentFilter(ACTION_USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED);
        try {
            Intent intent = new Intent(ACTION_USB_PERMISSION).setPackage(ctx.getPackageName());
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            um.requestPermission(d, PendingIntent.getBroadcast(ctx, 0, intent, flags));
            latch.await(60, TimeUnit.SECONDS);
        } finally {
            try { ctx.unregisterReceiver(r); } catch (Exception ignored) { }
        }
        return granted[0] || um.hasPermission(d);
    }

    // ───────────────────────── Rendu HTML -> image ─────────────────────────

    /** Largeur imprimable en pixels CSS (comme Windows : 72 mm -> 576 points à 203 dpi) */
    private static int cssWidth(int dots) { return (int) Math.round(dots / (double) DPI * 96.0); }

    private static String prepare(String rawHtml, int dots) {
        String head = "<meta name=\"viewport\" content=\"width=" + cssWidth(dots) + ", user-scalable=no\">"
                + "<style>html{width:100%!important;max-width:none!important;padding:0!important;overflow:visible!important;background:#fff!important}"
                + "body{margin:0 auto!important;overflow:visible!important}::-webkit-scrollbar{display:none!important}</style>";
        return rawHtml.contains("</head>") ? rawHtml.replace("</head>", head + "</head>") : head + rawHtml;
    }

    /**
     * Dessine le ticket dans une WebView placée sous l'interface de la caisse (jamais visible),
     * à la largeur exacte de la tête, par bandes en faisant défiler (comme la capture Windows).
     */
    private Bitmap render(String rawHtml, int dots) throws Exception {
        final Activity act = getActivity();
        if (act == null) throw new Exception("Caisse non affichée");
        final String html = prepare(rawHtml, dots);
        final double scale = dots / (double) cssWidth(dots);   // pixels par pixel CSS
        final CountDownLatch done = new CountDownLatch(1);
        final Bitmap[] out = {null};
        final String[] err = {null};
        final Handler ui = new Handler(Looper.getMainLooper());

        ui.post(() -> {
            final ViewGroup root = act.findViewById(android.R.id.content);
            final int slice = Math.max(300, Math.min(1000, root.getHeight() > 0 ? root.getHeight() : 1000));
            final WebView wv = new WebView(act);
            final AtomicBoolean finished = new AtomicBoolean(false);
            final Runnable cleanup = () -> {
                try { root.removeView(wv); } catch (Exception ignored) { }
                try { wv.destroy(); } catch (Exception ignored) { }
            };
            wv.setBackgroundColor(Color.WHITE);
            wv.setVerticalScrollBarEnabled(false);
            wv.setHorizontalScrollBarEnabled(false);
            wv.getSettings().setJavaScriptEnabled(true);
            wv.getSettings().setUseWideViewPort(true);
            wv.getSettings().setLoadWithOverviewMode(true);
            wv.getSettings().setSupportZoom(false);
            wv.getSettings().setTextZoom(100);
            root.addView(wv, 0, new FrameLayout.LayoutParams(dots, slice));

            wv.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void ready(final double cssHeight) {
                    ui.post(() -> {
                        if (finished.get()) return;
                        final int total = Math.max(50, Math.min((int) Math.ceil(cssHeight * scale) + 4, 30000));
                        final Bitmap full = Bitmap.createBitmap(dots, total, Bitmap.Config.ARGB_8888);
                        final Canvas fc = new Canvas(full);
                        fc.drawColor(Color.WHITE);
                        captureSlice(0, total, full, fc);
                    });
                }

                private void captureSlice(final int y, final int total, final Bitmap full, final Canvas fc) {
                    if (finished.get()) return;
                    if (y >= total) {
                        finished.set(true);
                        out[0] = full;
                        cleanup.run();
                        done.countDown();
                        return;
                    }
                    wv.evaluateJavascript("window.scrollTo(0," + (y / scale) + ");", v ->
                        ui.postDelayed(() -> {
                            if (finished.get()) return;
                            try {
                                Bitmap b = Bitmap.createBitmap(dots, slice, Bitmap.Config.ARGB_8888);
                                Canvas c = new Canvas(b);
                                c.drawColor(Color.WHITE);
                                c.translate(-wv.getScrollX(), -wv.getScrollY());
                                wv.draw(c);
                                int scrolled = wv.getScrollY();
                                int offset = Math.max(0, y - scrolled);
                                int h = Math.min(slice - offset, total - y);
                                if (h > 0) {
                                    fc.drawBitmap(b, new android.graphics.Rect(0, offset, dots, offset + h), new android.graphics.Rect(0, y, dots, y + h), null);
                                }
                                b.recycle();
                                captureSlice(y + Math.max(1, h), total, full, fc);
                            } catch (Throwable t) {
                                finished.set(true);
                                err[0] = t.toString();
                                cleanup.run();
                                done.countDown();
                            }
                        }, 120));
                }
            }, "CaisseRender");

            wv.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    view.evaluateJavascript("(async()=>{try{if(document.fonts&&document.fonts.ready)await document.fonts.ready;"
                            + "await Promise.all(Array.from(document.images).map(i=>i.complete?(i.decode?i.decode().catch(()=>{}):0):new Promise(r=>{i.onload=i.onerror=r})));}catch(e){}"
                            + "setTimeout(()=>{var b=document.body,d=document.documentElement;"
                            + "CaisseRender.ready(Math.max(b.scrollHeight,d.scrollHeight,b.getBoundingClientRect().bottom+window.scrollY));},120);})()", null);
                }
            });
            wv.loadDataWithBaseURL("https://caisseapp.vercel.app/", html, "text/html", "utf-8", null);

            ui.postDelayed(() -> {
                if (finished.getAndSet(true)) return;
                err[0] = "Délai dépassé pour dessiner le ticket";
                cleanup.run();
                done.countDown();
            }, 20000);
        });

        done.await(25, TimeUnit.SECONDS);
        if (out[0] == null) throw new Exception(err[0] != null ? err[0] : "Ticket non dessiné");
        return out[0];
    }

    // ───────────────────── Noir et blanc + ESC/POS (comme Windows) ─────────────────────

    private static class Mono {
        final List<byte[]> rows = new ArrayList<>();
        long black = 0;
    }

    /** Texte net (seuil), dégradés et logos tramés (diffusion d'erreur) */
    private static Mono toMono(Bitmap bmp, int dots) {
        int w = Math.min(bmp.getWidth(), dots), h = bmp.getHeight();
        int[] px = new int[bmp.getWidth() * h];
        bmp.getPixels(px, 0, bmp.getWidth(), 0, 0, bmp.getWidth(), h);
        int stride = bmp.getWidth();
        float[] lum = new float[w * h];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int c = px[y * stride + x];
                float a = ((c >>> 24) & 0xff) / 255f;
                float l = 0.299f * ((c >> 16) & 0xff) + 0.587f * ((c >> 8) & 0xff) + 0.114f * (c & 0xff);
                lum[y * w + x] = l * a + 255 * (1 - a);
            }
        }
        Mono m = new Mono();
        // On retire les lignes blanches de la fin (ticket plus court que la zone dessinée)
        int last = h - 1;
        outer:
        for (; last > 0; last--) {
            for (int x = 0; x < w; x++) if (lum[last * w + x] < 200) break outer;
        }
        int height = Math.min(h, last + 12);
        for (int y = 0; y < height; y++) {
            byte[] line = new byte[dots / 8];
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                float old = lum[i];
                boolean isBlack = old < 70 || (old <= 215 && old < 128);
                if (old >= 70 && old <= 215) {
                    float e = old - (isBlack ? 0 : 255);
                    if (x + 1 < w) lum[i + 1] += e * 7 / 16;
                    if (y + 1 < h) {
                        if (x > 0) lum[i + w - 1] += e * 3 / 16;
                        lum[i + w] += e * 5 / 16;
                        if (x + 1 < w) lum[i + w + 1] += e / 16;
                    }
                }
                if (isBlack) {
                    line[x >> 3] |= (byte) (0x80 >> (x & 7));
                    m.black++;
                }
            }
            m.rows.add(line);
        }
        return m;
    }

    private static byte[] escPosImage(Mono m, int dots, boolean cut) {
        int bpr = dots / 8;
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(0x1b); o.write(0x40);
        for (int start = 0; start < m.rows.size(); start += 256) {
            int n = Math.min(256, m.rows.size() - start);
            o.write(new byte[]{0x1d, 0x76, 0x30, 0x00, (byte) (bpr & 0xff), (byte) (bpr >> 8), (byte) (n & 0xff), (byte) (n >> 8)}, 0, 8);
            for (int i = 0; i < n; i++) o.write(m.rows.get(start + i), 0, bpr);
        }
        o.write(new byte[]{0x1b, 0x64, 0x04}, 0, 3);
        if (cut) o.write(new byte[]{0x1d, 0x56, 0x42, 0x00}, 0, 4);
        return o.toByteArray();
    }
}
