// Состояние разрешений браузера (без запроса — только чтение).

/** 'granted' | 'denied' | 'prompt' | 'unknown' */
export async function gpsPermission() {
  if (!navigator.geolocation) return 'denied';
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' });
    return p?.state ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function notificationPermission() {
  return globalThis.Notification ? Notification.permission : 'unsupported';
}

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
