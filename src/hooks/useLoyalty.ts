import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getUserLoyaltyStats, getProfileLoyaltyPoints, ensureProfilePointsSynced } from '@/lib/loyaltyPoints';

export const useLoyalty = () => {
  const [hasSession, setHasSession] = useState(false);
  const [loyaltyCode, setLoyaltyCode] = useState<string | null>(null);
  const [profilePoints, setProfilePoints] = useState<number | null>(null);
  const [loyaltyStats, setLoyaltyStats] = useState<{ totalPoints: number; totalEarned?: number; totalSpent?: number }>({ totalPoints: 0 });

  const loadLoyaltyInfo = useCallback(async () => {
    try {
      const storedCode = localStorage.getItem('loyaltyCode');
      const storedUserId = localStorage.getItem('loyaltyUserId');
      const storedPoints = localStorage.getItem('loyaltyPoints');

      if (storedCode && storedUserId) {
        setHasSession(true);
        try {
          const dbBalance = await getProfileLoyaltyPoints(storedUserId);
          setLoyaltyStats({ totalPoints: dbBalance });
          localStorage.setItem('loyaltyPoints', dbBalance.toString());
        } catch (error) {
          console.error('Erreur lecture points:', error);
          if (storedPoints) {
            const points = parseInt(storedPoints, 10);
            if (!isNaN(points) && points >= 0) {
              setLoyaltyStats({ totalPoints: points });
            }
          }
        }
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      setHasSession(Boolean(session?.user));
      
      if (session?.user) {
        try {
          const stats = await getUserLoyaltyStats(session.user.id);
          setLoyaltyStats(stats);
        } catch (err) {
          console.error('Erreur récupération points fidélité (menu):', err);
        }
        try {
          const pts = await getProfileLoyaltyPoints(session.user.id);
          setProfilePoints(typeof pts === 'number' ? pts : 0);
          setLoyaltyStats(prev => ({ ...prev, totalPoints: pts }));
        } catch (err) {
          console.error('Erreur lecture profiles.loyalty_points (menu):', err);
          setProfilePoints(null);
        }
        try {
          const res = await ensureProfilePointsSynced(session.user.id);
          if (res.synced && typeof res.newValue === 'number') {
            setProfilePoints(res.newValue);
            setLoyaltyStats(prev => ({ ...prev, totalPoints: res.newValue as number }));
          }
        } catch (_e) { }
        try {
          // --- LA CORRECTION EST ICI : on limite à 1 résultat pour éviter le crash ---
          const { data: profileData, error } = await supabase
            .from('profiles')
            .select('loyalty_code')
            .eq('id', session.user.id)
            .limit(1)
            .maybeSingle();
            
          if (error) throw error;
          setLoyaltyCode(profileData?.loyalty_code ?? null);
        } catch (err) {
          console.error('Erreur récupération code fidélité (menu):', err);
          setLoyaltyCode(null);
        }
      }
    } catch (e) {
      console.error('Erreur chargement infos fidélité:', e);
    }
  }, []);

  useEffect(() => {
    loadLoyaltyInfo();
  }, [loadLoyaltyInfo]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, _session) => {
      loadLoyaltyInfo();
    });
    return () => subscription?.unsubscribe();
  }, [loadLoyaltyInfo]);

  useEffect(() => {
    const handleLoyaltyUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      const newBalance = customEvent.detail?.newBalance;
      if (typeof newBalance === 'number') {
        setLoyaltyStats(prev => ({ ...prev, totalPoints: newBalance }));
      }
    };
    window.addEventListener('loyaltyPointsUpdated', handleLoyaltyUpdate);
    return () => window.removeEventListener('loyaltyPointsUpdated', handleLoyaltyUpdate);
  }, []);

  useEffect(() => {
    const refreshLoyaltyPoints = async () => {
      try {
        const storedCode = localStorage.getItem('loyaltyCode');
        const storedUserId = localStorage.getItem('loyaltyUserId');

        if (storedCode && storedUserId) {
          const newBalance = await getProfileLoyaltyPoints(storedUserId);
          setLoyaltyStats(prev => ({ ...prev, totalPoints: newBalance }));
          localStorage.setItem('loyaltyPoints', newBalance.toString());
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (data?.session?.user?.id) {
          const newBalance = await getProfileLoyaltyPoints(data.session.user.id);
          setLoyaltyStats(prev => ({ ...prev, totalPoints: newBalance }));
        }
      } catch (error) {
        console.error('Erreur refresh points:', error);
      }
    };

    const interval = setInterval(refreshLoyaltyPoints, 10000);
    return () => clearInterval(interval);
  }, []);

  return {
    hasSession,
    loyaltyCode,
    profilePoints,
    loyaltyStats
  };
};