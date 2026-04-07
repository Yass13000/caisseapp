// Fonction utilitaire pour vérifier si le restaurant est ouvert
export const isRestaurantOpen = () => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentDay = now.getDay(); // 0 = Dimanche, 1 = Lundi, etc.
  
  // Horaires d'ouverture normaux : Lundi-Dimanche 11h-23h
  if (currentDay === 0) { // Dimanche
    return currentHour >= 11 && currentHour < 23;
  } else { // Lundi à Samedi
    return currentHour >= 11 && currentHour < 23;
  }
};

// Fonction pour obtenir le message d'état du restaurant
export const getRestaurantStatus = () => {
  return isRestaurantOpen() ? 'Ouvert' : 'Fermé';
};

// Fonction pour obtenir les horaires d'ouverture
export const getOpeningHours = () => {
  return "Lundi - Dimanche : 11h00 - 23h00";
};
