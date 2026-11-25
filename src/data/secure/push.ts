import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { setPushToken } from './client';
import { setAppActive, subscribeActivity, unreadCount, type Activity } from '../activity';

// Push wake-ups. When something arrives for this phone, the relay asks Apple to wake the app silently.
// The app fetches and decrypts the new messages here on the phone and shows its own notification with
// the real text ("Alex: Who’s bringing chairs?"), which Apple and the relay never see. If iOS doesn't
// wake the app in time, the relay falls back to one that says only "You have something new."

// While the app is open, new things go to the bell instead of a banner. Plan reminders still show.
Notifications.setNotificationHandler({
  handleNotification: async n => {
    const show = (n.request.content.data as { kind?: string } | undefined)?.kind === 'reminder';
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
  },
});

let registered = false;
let onWake: (() => void) | null = null;
const env = (): 'sandbox' | 'production' => (__DEV__ ? 'sandbox' : 'production');

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
    // bg: this version writes its own notifications, so the relay sends a silent wake-up first.
    await setPushToken(String(t.data), env(), true);
    registered = true;
    return 'on';
  } catch (e) {
    if (__DEV__) console.log('[push] could not register', String(e));
    return 'unavailable';
  }
}

/** Notifications allowed in iOS Settings? */
export async function pushAllowed(): Promise<boolean> {
  try { return (await Notifications.getPermissionsAsync()).granted; } catch { return false; }
}

const setBadge = () => { Notifications.setBadgeCountAsync(unreadCount()).catch(() => {}); };

/** Shows a phone notification for something new, when the app isn't on screen. */
export function postActivity(a: Activity) {
  if (AppState.currentState === 'active') { setBadge(); return; }
  Notifications.scheduleNotificationAsync({
    content: {
      title: a.title, body: a.body, sound: 'default', badge: unreadCount(),
      data: { route: a.route, ...(a.hood ? { hood: a.hood } : {}), aid: a.id, kind: a.kind },
      threadIdentifier: a.group ?? a.kind,
    },
    trigger: null,
  }).catch(e => { if (__DEV__) console.log('[push] could not post', String(e)); });
}

/** Calls `wake` whenever a push arrives or the app is opened, and keeps the app badge at the number of
 *  unread notifications. The phone's notification list is cleared on opening: the bell has them all. */
export function listenForWakeups(wake: () => void) {
  onWake = wake;
  // The app icon's badge follows the bell: reading something here takes it off the icon too.
  let last = -1, t: ReturnType<typeof setTimeout> | null = null;
  subscribeActivity(() => { if (t) return; t = setTimeout(() => { t = null; const n = unreadCount(); if (n !== last) { last = n; setBadge(); } }, 500); });
  Notifications.addNotificationReceivedListener(() => { if (__DEV__) console.log('[push] wake-up received'); onWake?.(); });
  Notifications.addNotificationResponseReceivedListener(() => onWake?.());
  AppState.addEventListener('change', s => {
    setAppActive(s === 'active');
    if (s !== 'active') return;
    setBadge();
    Notifications.dismissAllNotificationsAsync().catch(() => {});
    onWake?.();
  });
  Notifications.addPushTokenListener(t => { if (registered) setPushToken(String(t.data), env(), true).catch(() => {}); });
}
export { setBadge as refreshBadge };
