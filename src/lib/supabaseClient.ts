import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// On exporte RESTAURANT_ID pour qu'il soit accessible partout
// Priorité au localStorage (pour l'admin/borne), sinon fallback sur la variable d'environnement
export const RESTAURANT_ID = typeof window !== 'undefined' 
  ? (localStorage.getItem('admin_override_restaurant_id') || import.meta.env.VITE_RESTAURANT_ID)
  : import.meta.env.VITE_RESTAURANT_ID;