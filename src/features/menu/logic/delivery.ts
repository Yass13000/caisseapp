// Logic utilitaire pour l'adresse de livraison
// Extrait depuis Menu.tsx pour alléger le composant

export function getStoredDeliveryAddress(orderType?: string | null): string | null {
  try {
    if (!orderType) return null;
    const normalizedType = orderType.toLowerCase();
    if (!normalizedType.includes('livraison')) return null;
    const deliveryAddressData = window.localStorage.getItem('deliveryAddress');
    if (!deliveryAddressData) return null;
    const parsed = JSON.parse(deliveryAddressData);
    return parsed?.address || null;
  } catch (_) {
    return null;
  }
}
