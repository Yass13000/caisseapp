// Script pour nettoyer complètement le cache du navigateur en développement
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  console.log('🧹 Nettoyage des caches en développement...');

  // Nettoyer localStorage MAIS préserver les données de fidélité
  try {
    // Sauvegarder les données de fidélité avant le clear
    const loyaltyData = {
      loyaltyCode: localStorage.getItem('loyaltyCode'),
      loyaltyUserId: localStorage.getItem('loyaltyUserId'),
      loyaltyUserName: localStorage.getItem('loyaltyUserName'),
      loyaltyPoints: localStorage.getItem('loyaltyPoints')
    };

    localStorage.clear();

    // Restaurer les données de fidélité si elles existaient
    if (loyaltyData.loyaltyCode) {
      localStorage.setItem('loyaltyCode', loyaltyData.loyaltyCode);
    }
    if (loyaltyData.loyaltyUserId) {
      localStorage.setItem('loyaltyUserId', loyaltyData.loyaltyUserId);
    }
    if (loyaltyData.loyaltyUserName) {
      localStorage.setItem('loyaltyUserName', loyaltyData.loyaltyUserName);
    }
    if (loyaltyData.loyaltyPoints) {
      localStorage.setItem('loyaltyPoints', loyaltyData.loyaltyPoints);
    }

    console.log('✅ localStorage vidé (données fidélité préservées)');
  } catch (e) {
    console.log('⚠️ Erreur localStorage:', e);
  }
  
  // Nettoyer sessionStorage
  try {
    sessionStorage.clear();
    console.log('✅ sessionStorage vidé');
  } catch (e) {
    console.log('⚠️ Erreur sessionStorage:', e);
  }
  
  // Nettoyer les caches
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => {
        caches.delete(name);
        console.log('✅ Cache supprimé:', name);
      });
    });
  }
  
  // Forcer le désenregistrement des service workers
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.unregister();
        console.log('✅ Service Worker désenregistré:', registration.scope);
      });
    });
  }
  
  console.log('🎉 Nettoyage terminé!');
}
