import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

interface PaymentSettings {
  card_payment_enabled: boolean;
  counter_payment_enabled: boolean;
}

export function usePaymentSettings() {
  const [settings, setSettings] = useState<PaymentSettings>({
    card_payment_enabled: true,
    counter_payment_enabled: true,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('payment_settings')
          .select('card_payment_enabled, counter_payment_enabled')
          .single();

        if (error) {
          console.error('Erreur récupération paramètres de paiement:', error);
          return;
        }

        if (data) {
          setSettings(data);
        }
      } catch (error) {
        console.error('Erreur:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();

    // S'abonner aux changements en temps réel
    const channel = supabase
      .channel('payment_settings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'payment_settings',
        },
        (payload) => {
          if (payload.new) {
            setSettings(payload.new as PaymentSettings);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { settings, loading };
}
