// Remplace le client Supabase de l'app pendant le test (le test lit la base lui-même, en lecture seule).
export const supabase: any = {};
export const RESTAURANT_ID = '';
export const getActiveRestaurantId = () => '';
