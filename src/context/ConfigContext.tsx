import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';

interface AppConfig {
  logo: string | null;
  restaurantName: string | null;
}

interface ConfigContextProps {
  config: AppConfig;
  refreshConfig: () => Promise<void>; // Permet de forcer la synchro manuellement si besoin
}

const ConfigContext = createContext<ConfigContextProps | undefined>(undefined);

// Fonction utilitaire pour convertir le HEX en HSL (format attendu par Tailwind/Shadcn)
const hexToHslString = (hex: string) => {
  hex = hex.replace(/^#/, '');
  let r = parseInt(hex.substring(0, 2), 16) / 255;
  let g = parseInt(hex.substring(2, 4), 16) / 255;
  let b = parseInt(hex.substring(4, 6), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${(h * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
};

export const ConfigProvider = ({ children }: { children: React.ReactNode }) => {
  const [config, setConfig] = useState<AppConfig>({
    logo: null,
    restaurantName: null,
  });

  const fetchAndApplyTheme = useCallback(async () => {
    // La correction est ici : on lit la bonne clé utilisée par votre borne
    const restaurantId = localStorage.getItem('admin_override_restaurant_id');
    
    if (!restaurantId) return;

    const { data, error } = await supabase
      .from('restaurants')
      .select('theme_primary, theme_secondary, theme_accent, theme_background, logo_url, restaurant_name')
      .eq('id', restaurantId)
      .single();

    if (data && !error) {
      const root = document.documentElement;
      
      // Mise à jour chirurgicale des variables CSS globales
      if (data.theme_primary) root.style.setProperty('--primary', hexToHslString(data.theme_primary));
      if (data.theme_secondary) root.style.setProperty('--secondary', hexToHslString(data.theme_secondary));
      if (data.theme_accent) root.style.setProperty('--accent', hexToHslString(data.theme_accent));
      if (data.theme_background) root.style.setProperty('--background', hexToHslString(data.theme_background));

      // Mise à jour du state pour le logo et le nom
      setConfig({
        logo: data.logo_url,
        restaurantName: data.restaurant_name,
      });
    }
  }, []);

  useEffect(() => {
    fetchAndApplyTheme();

    // Écouteur d'événement pour synchroniser automatiquement quand l'ID change
    window.addEventListener('restaurant_id_changed', fetchAndApplyTheme);
    return () => {
      window.removeEventListener('restaurant_id_changed', fetchAndApplyTheme);
    };
  }, [fetchAndApplyTheme]);

  return (
    <ConfigContext.Provider value={{ config, refreshConfig: fetchAndApplyTheme }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useAppConfig = () => {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useAppConfig must be used within a ConfigProvider');
  }
  return context;
};