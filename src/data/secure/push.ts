import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { setPushToken } from './client';

// Push wake-ups. When something arrives for this phone, the relay asks Apple to show a notification
// that says only "You have something new." — no sender, no text, nothing Apple could read. Opening it
// (or the app) fetches and decrypts the real messages here on the phone.

// While the app is open the messages show up live, so no banner on top of them.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
});

let registered = false;
let onWake: (() => void) | null = null;

/** Asks for permission (once; iOS remembers the answer) and registers the push token with the relay.
 *  Call it once the person has someone to hear from: after joining a neighborhood or connecting. */
export async function enablePush(): Promise<'on' | 'denied' | 'unavailable'> {
  if (Platform.OS !== 'ios') return 'unavailable';
  try {
    let perm = await Notifications.getPermissionsAsync();
    if (perm.status === 'undetermined') perm = await Notifications.requestPermissionsAsync();
    const ok = perm.granted;
    if (!ok) return 'denied';
    if (__DEV__) console.log('[push] permission granted, asking Apple for a token');
    // Apple usually answers in a second; never wait forever (simulators often don't answer at all).
    const t = await Promise.race([
      Notifications.getDevicePushTokenAsync(),
      new Promise<never>((_, no) => setTimeout(() => no(new Error('no push token from Apple within 20 s')), 20_000)),
    ]);
    if (__DEV__) console.log('[push] got token', String(t.data).slice(0, 8) + '…');
    // Development builds talk to Apple's test servers; TestFlight and App Store builds to the real ones.
    await setPushToken(String(t.data), __DEV__ ? 'sandbox' : 'production');
    registered = true;
    return 'on';
  } catch (e) {
    if (__DEV__) console.log('[push] could not register', String(e));
    return 'unavailable';
  }
}

/** Calls `wake` whenever a push arrives or is tapped, and clears the app badge when the app is opened. */
export function listenForWakeups(wake: () => void) {
  onWake = wake;
  Notifications.addNotificationReceivedListener(() => { if (__DEV__) console.log('[push] wake-up received'); onWake?.(); });
  Notifications.addNotificationResponseReceivedListener(() => onWake?.());
  AppState.addEventListener('change', s => {
    if (s !== 'active') return;
    Notifications.setBadgeCountAsync(0).catch(() => {});
    Notifications.dismissAllNotificationsAsync().catch(() => {});
    onWake?.();
  });
  Notifications.addPushTokenListener(t => { if (registered) setPushToken(String(t.data), __DEV__ ? 'sandbox' : 'production').catch(() => {}); });
}
