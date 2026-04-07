import { createRoot } from 'react-dom/client'
import App from './App.tsx';
import './index.css';
import './styles/kiosk-dimensions.css';
import { validateEnvironment } from './lib/envValidation';
import { initSentry } from './lib/errorLogging';
// Import pour activer le nouveau cache ultra-rapide de l'APK
import { registerSW } from 'virtual:pwa-register';

// Initialize error logging first
try {
  initSentry();
} catch (error) {
  console.warn('Error logging initialization failed (non-blocking):', error);
}

// Validate environment variables before rendering
try {
  validateEnvironment();
  console.log('✅ Environment variables validated');
} catch (error) {
  console.error('❌ Failed to validate environment:', error);
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <div style={{ padding: '20px', fontFamily: 'sans-serif', color: 'red' }}>
      <h1>Configuration Error</h1>
      <p>{error instanceof Error ? error.message : 'Unknown error'}</p>
      <p>Please check your .env file and restart the development server.</p>
    </div>
  );
  throw error;
}

// L'App n'est plus enveloppée par le ThemeProvider supprimé
createRoot(document.getElementById("root")!).render(
  <App />
);

// =========================================
// OPTIMISATIONS BORNE KIOSQUE (APK)
// =========================================

// 1. Désactiver le clic droit et l'appui long (anti-menu contextuel Android)
// Cela empêche les clients de faire bugger la tablette en laissant leur doigt appuyé
if (typeof window !== 'undefined') {
  window.oncontextmenu = function(e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };
}

// 2. Enregistrement du nouveau Service Worker (Vite PWA)
// On remplace la destruction par l'activation du mode hors-ligne/cache rapide
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
  console.log('🚀 Service Worker (PWA) activé avec succès pour la borne !');
}

// 3. Préchargement des images critiques
window.addEventListener('load', () => {
  const criticalImages = ['/iconmob.png', '/placeholder.svg'];
  criticalImages.forEach(src => {
    const img = new Image();
    img.src = src;
  });
});