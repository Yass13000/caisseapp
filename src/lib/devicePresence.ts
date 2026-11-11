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
