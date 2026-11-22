import type { CapacitorConfig } from '@capacitor/cli';

// L'app Android charge l'interface en ligne (même version que Windows, mise à jour à chaque déploiement).
// Les modules natifs (lecteur SumUp Bluetooth, imprimante…) restent dans l'APK.
// Sans réseau au démarrage : page locale offline.html qui réessaie toute seule.
const config: CapacitorConfig = {
  appId: 'com.project1.caisse',
  appName: 'Caisse',
  webDir: 'dist',
  server: {
    url: 'https://caisseapp.vercel.app',
    androidScheme: 'https',
    errorPath: 'offline.html',
    allowNavigation: ['caisseapp.vercel.app'],
  },
};

export default config;
