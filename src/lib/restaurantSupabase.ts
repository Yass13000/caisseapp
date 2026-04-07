import { supabase } from './supabaseClient';

// Interface pour les horaires d'ouverture selon la structure de ta table
interface OpeningHour {
  day_of_week: number; // 0 = Dimanche, 1 = Lundi, ..., 6 = Samedi (clé primaire)
  is_closed: boolean;
  open_time_lunch: string | null;
  close_time_lunch: string | null;
  open_time_evening: string | null;
  close_time_evening: string | null;
  day_name: string | null;
}

// Cache des horaires pour éviter les appels répétés à Supabase
let openingHoursCache: OpeningHour[] | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Fonction pour récupérer les horaires depuis Supabase
export const fetchOpeningHours = async (): Promise<OpeningHour[]> => {
  const now = Date.now();
  
  // Utiliser le cache si il est encore valide
  if (openingHoursCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return openingHoursCache;
  }

  try {
    const { data, error } = await supabase
      .from('opening_hours')
      .select('*')
      .order('day_of_week', { ascending: true });

    if (error) {
      return getDefaultOpeningHours();
    }

    if (data && data.length > 0) {
      openingHoursCache = data;
      cacheTimestamp = now;
            return data;
    } else {
            return getDefaultOpeningHours();
    }
  } catch (err) {
    return getDefaultOpeningHours();
  }
};

// Horaires par défaut pour le restaurant (service continu)
const getDefaultOpeningHours = (): OpeningHour[] => {
  return [
    { day_of_week: 0, is_closed: false, open_time_lunch: '11:30:00', close_time_lunch: '22:30:00', open_time_evening: null, close_time_evening: null, day_name: 'Dimanche' },
    { day_of_week: 1, is_closed: false, open_time_lunch: '11:30:00', close_time_lunch: '22:30:00', open_time_evening: null, close_time_evening: null, day_name: 'Lundi' },
    { day_of_week: 2, is_closed: false, open_time_lunch: '11:30:00', close_time_lunch: '22:30:00', open_time_evening: null, close_time_evening: null, day_name: 'Mardi' },
    { day_of_week: 3, is_closed: false, open_time_lunch: '11:30:00', close_time_lunch: '22:30:00', open_time_evening: null, close_time_evening: null, day_name: 'Mercredi' },
    { day_of_week: 4, is_closed: false, open_time_lunch: '11:30:00', close_time_lunch: '22:30:00', open_time_evening: null, close_time_evening: null, day_name: 'Jeudi' },
    { day_of_week: 5, is_closed: false, open_time_lunch: '11:30:00', close_time_lunch: '22:30:00', open_time_evening: null, close_time_evening: null, day_name: 'Vendredi' },
    { day_of_week: 6, is_closed: false, open_time_lunch: '11:30:00', close_time_lunch: '22:30:00', open_time_evening: null, close_time_evening: null, day_name: 'Samedi' }
  ];
};

// Fonction pour convertir le temps en minutes depuis minuit
const timeToMinutes = (timeString: string): number => {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
};

// Fonction pour vérifier si le restaurant est ouvert maintenant
export const isRestaurantOpen = async (): Promise<boolean> => {
  // BLOCAGE DÉSACTIVÉ : On force le retour à `true` pour autoriser les commandes 24/7
  return true;
};

// Version synchrone pour la compatibilité (utilise le cache)
export const isRestaurantOpenSync = (): boolean => {
  // BLOCAGE DÉSACTIVÉ : On force le retour à `true` pour autoriser les commandes 24/7
  return true;
};

// Fonction pour obtenir le message d'état du restaurant (simple)
export const getRestaurantStatus = async (): Promise<string> => {
  const isOpen = await isRestaurantOpen();
  return isOpen ? 'Ouvert' : 'Fermé';
};

// Fonction pour obtenir l'heure de prochaine ouverture/fermeture
export const getNextOpenCloseTime = async (): Promise<string> => {
  try {
    const openingHours = await fetchOpeningHours();
    const isOpen = await isRestaurantOpen();
    
    if (!openingHours || openingHours.length === 0) {
      return isOpen ? 'Ouvert jusqu\'à 22h30' : 'Fermé jusqu\'à 11h30';
    }

    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const todayHours = openingHours.find(hour => hour.day_of_week === currentDay);
    
    if (!todayHours || todayHours.is_closed) {
      // Chercher le prochain jour d'ouverture
      for (let i = 1; i <= 7; i++) {
        const nextDay = (currentDay + i) % 7;
        const nextDayHours = openingHours.find(hour => hour.day_of_week === nextDay);
        if (nextDayHours && !nextDayHours.is_closed && nextDayHours.open_time_lunch) {
          const openTime = nextDayHours.open_time_lunch.substring(0, 5);
          const dayName = getDayName(nextDay);
          return i === 1 ? `Fermé jusqu'à demain ${openTime}` : `Fermé jusqu'à ${dayName} ${openTime}`;
        }
      }
      return 'Fermé';
    }

    if (isOpen) {
      // Le restaurant est ouvert, chercher l'heure de fermeture
      if (todayHours.open_time_lunch && todayHours.close_time_lunch) {
        const lunchStart = timeToMinutes(todayHours.open_time_lunch);
        const lunchEnd = timeToMinutes(todayHours.close_time_lunch);
        if (currentTime >= lunchStart && currentTime < lunchEnd) {
          const closeTime = todayHours.close_time_lunch.substring(0, 5);
          return `Ouvert jusqu'à ${closeTime}`;
        }
      }
      
      if (todayHours.open_time_evening && todayHours.close_time_evening) {
        const eveningStart = timeToMinutes(todayHours.open_time_evening);
        const eveningEnd = timeToMinutes(todayHours.close_time_evening);
        if (currentTime >= eveningStart && currentTime < eveningEnd) {
          const closeTime = todayHours.close_time_evening.substring(0, 5);
          return `Ouvert jusqu'à ${closeTime}`;
        }
      }
    } else {
      // Le restaurant est fermé, chercher la prochaine ouverture
      if (todayHours.open_time_lunch && todayHours.close_time_lunch) {
        const lunchStart = timeToMinutes(todayHours.open_time_lunch);
        if (currentTime < lunchStart) {
          const openTime = todayHours.open_time_lunch.substring(0, 5);
          return `Fermé jusqu'à ${openTime}`;
        }
      }
      
      if (todayHours.open_time_evening && todayHours.close_time_evening) {
        const eveningStart = timeToMinutes(todayHours.open_time_evening);
        if (currentTime < eveningStart) {
          const openTime = todayHours.open_time_evening.substring(0, 5);
          return `Fermé jusqu'à ${openTime}`;
        }
      }
      
      // Si on arrive ici, c'est qu'on est après la dernière fermeture de la journée
      // Chercher le prochain jour d'ouverture
      for (let i = 1; i <= 7; i++) {
        const nextDay = (currentDay + i) % 7;
        const nextDayHours = openingHours.find(hour => hour.day_of_week === nextDay);
        if (nextDayHours && !nextDayHours.is_closed && nextDayHours.open_time_lunch) {
          const openTime = nextDayHours.open_time_lunch.substring(0, 5);
          const dayName = getDayName(nextDay);
          return i === 1 ? `Fermé jusqu'à demain ${openTime}` : `Fermé jusqu'à ${dayName} ${openTime}`;
        }
      }
    }

    // Fallback - ne devrait jamais arriver
    return isOpen ? 'Ouvert' : 'Fermé jusqu\'à demain 11h30';
  } catch (error) {
    return 'Fermé jusqu\'à 11h30';
  }
};

// Fonction pour obtenir les horaires d'ouverture formatés
export const getOpeningHours = async (): Promise<string> => {
  try {
    const openingHours = await fetchOpeningHours();
    
    if (!openingHours || openingHours.length === 0) {
            return "Lundi - Dimanche : 11h30 - 22h30";
    }

    // Chercher s'il y a un format uniforme pour tous les jours
    const workingDays = openingHours.filter(h => !h.is_closed);
    
    if (workingDays.length === 0) {
      return "Restaurant fermé";
    }

    // Vérifier si tous les jours ouverts ont les mêmes horaires
    const firstDay = workingDays[0];
    const allSame = workingDays.every(day => 
      day.open_time_lunch === firstDay.open_time_lunch &&
      day.close_time_lunch === firstDay.close_time_lunch &&
      day.open_time_evening === firstDay.open_time_evening &&
      day.close_time_evening === firstDay.close_time_evening
    );

    if (allSame && workingDays.length === 7) {
      // Tous les jours sont ouverts avec les mêmes horaires
      if (firstDay.open_time_lunch && firstDay.close_time_lunch) {
        const start = firstDay.open_time_lunch.substring(0, 5);
        const end = firstDay.close_time_lunch.substring(0, 5);
        
        if (firstDay.open_time_evening && firstDay.close_time_evening) {
          const eveningStart = firstDay.open_time_evening.substring(0, 5);
          const eveningEnd = firstDay.close_time_evening.substring(0, 5);
          return `Tous les jours : ${start}-${end} • ${eveningStart}-${eveningEnd}`;
        } else {
          return `Tous les jours : ${start} - ${end}`;
        }
      }
    }

    // Créer un résumé des horaires du jour actuel
    const today = openingHours.find(h => h.day_of_week === new Date().getDay());
    
    if (!today) {
      return "Horaires non disponibles pour aujourd'hui";
    }

    if (today.is_closed) {
      return "Fermé aujourd'hui";
    }

    let schedule = "";
    
    if (today.open_time_lunch && today.close_time_lunch) {
      const lunchStart = today.open_time_lunch.substring(0, 5);
      const lunchEnd = today.close_time_lunch.substring(0, 5);
      schedule = `${lunchStart} - ${lunchEnd}`;
      
      if (today.open_time_evening && today.close_time_evening) {
        const eveningStart = today.open_time_evening.substring(0, 5);
        const eveningEnd = today.close_time_evening.substring(0, 5);
        schedule += ` • ${eveningStart} - ${eveningEnd}`;
      }
    } else if (today.open_time_evening && today.close_time_evening) {
      const eveningStart = today.open_time_evening.substring(0, 5);
      const eveningEnd = today.close_time_evening.substring(0, 5);
      schedule = `${eveningStart} - ${eveningEnd}`;
    }

    return schedule || "11h30 - 22h30";
  } catch (error) {
    return "Lundi - Dimanche : 11h30 - 22h30";
  }
};

// Fonction pour obtenir les horaires détaillés de la semaine
export const getDetailedOpeningHours = async (): Promise<string[]> => {
  try {
    const openingHours = await fetchOpeningHours();
    
    if (!openingHours || openingHours.length === 0) {
            return [
        "Lundi : 11h30 - 22h30",
        "Mardi : 11h30 - 22h30", 
        "Mercredi : 11h30 - 22h30",
        "Jeudi : 11h30 - 22h30",
        "Vendredi : 11h30 - 22h30",
        "Samedi : 11h30 - 22h30",
        "Dimanche : 11h30 - 22h30"
      ];
    }

    // Trier par jour de la semaine (0=Dimanche, 1=Lundi, etc.)
    const sortedHours = openingHours.sort((a, b) => {
      // Mettre dimanche à la fin
      const dayA = a.day_of_week === 0 ? 7 : a.day_of_week;
      const dayB = b.day_of_week === 0 ? 7 : b.day_of_week;
      return dayA - dayB;
    });
    
    return sortedHours.map(hour => {
      const dayName = hour.day_name || getDayName(hour.day_of_week);
      
      if (hour.is_closed) {
        return `${dayName} : Fermé`;
      }

      let timeString = "";
      
      if (hour.open_time_lunch && hour.close_time_lunch) {
        const lunchStart = hour.open_time_lunch.substring(0, 5);
        const lunchEnd = hour.close_time_lunch.substring(0, 5);
        timeString = `${lunchStart} - ${lunchEnd}`;
        
        if (hour.open_time_evening && hour.close_time_evening) {
          const eveningStart = hour.open_time_evening.substring(0, 5);
          const eveningEnd = hour.close_time_evening.substring(0, 5);
          timeString += ` • ${eveningStart} - ${eveningEnd}`;
        }
      } else if (hour.open_time_evening && hour.close_time_evening) {
        // Seulement le dîner
        const eveningStart = hour.open_time_evening.substring(0, 5);
        const eveningEnd = hour.close_time_evening.substring(0, 5);
        timeString = `${eveningStart} - ${eveningEnd}`;
      }

      return `${dayName} : ${timeString || '11h30 - 22h30'}`;
    });
  } catch (error) {
    return [
      "Lundi : 11h30 - 22h30",
      "Mardi : 11h30 - 22h30", 
      "Mercredi : 11h30 - 22h30",
      "Jeudi : 11h30 - 22h30",
      "Vendredi : 11h30 - 22h30",
      "Samedi : 11h30 - 22h30",
      "Dimanche : 11h30 - 22h30"
    ];
  }
};

// Fonction helper pour obtenir le nom du jour
const getDayName = (dayOfWeek: number): string => {
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  return days[dayOfWeek] || 'Jour inconnu';
};

// Initialiser le cache au premier appel
export const initializeOpeningHours = async () => {
    await fetchOpeningHours();
};