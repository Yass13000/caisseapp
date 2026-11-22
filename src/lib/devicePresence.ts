import type { SupabaseClient } from '@supabase/supabase-js';

export type DeviceKind = 'pos' | 'kds' | 'screencall' | 'kiosk';

export interface DevicePresence {
  device_id: string;
  device_type: DeviceKind;
  device_name: string;
  online_since: string;
}

export const devicePresenceChannel = (restaurantId: string) => `devices_${restaurantId}`;

/** À appeler une fois l'appareil associé. Renvoie une fonction pour se retirer. */
export const announceDevicePresence = (
  supabase: SupabaseClient,
  params: { restaurantId: string; deviceId: string; deviceType: DeviceKind; deviceName: string }
): (() => void) => {
  const channel = supabase.channel(devicePresenceChannel(params.restaurantId), {
    config: { presence: { key: params.deviceId } },
  });
  const me: DevicePresence = {
    device_id: params.deviceId,
    device_type: params.deviceType,
    device_name: params.deviceName,
    online_since: new Date().toISOString(),
  };
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') void channel.track(me);
  });
  return () => {
    void channel.untrack();
    void supabase.removeChannel(channel);
  };
};

/**
 * Identifiant d'appareil compatible avec TOUS les navigateurs.
 * ⚠️ crypto.randomUUID() n'existe pas sur les vieilles TV / tablettes Android (navigateur < 2021) :
 * l'appeler directement faisait planter l'écran (écran blanc juste après l'appairage).
 */
export const newDeviceId = (): string => {
  try {
    const c: any = typeof crypto !== 'undefined' ? crypto : null;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    /* navigateur ancien : identifiant maison ci-dessous */
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};
