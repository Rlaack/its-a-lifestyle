import '@/data/backgroundSync';
import { useEffect } from 'react';
import { AppState, Linking } from 'react-native';
import { Stack, usePathname } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { AlfaSlabOne_400Regular } from '@expo-google-fonts/alfa-slab-one';
import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold } from '@expo-google-fonts/figtree';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@/theme/theme';
import { Toaster } from '@/components/Toast';
import { PrivacyGuard } from '@/components/PrivacyGuard';
import { AccountClosed } from '@/components/AccountClosed';
import { actions } from '@/data/store';
import { startSecureMessaging, useSecureStatus } from '@/data/secure/sync';
import { installCrashCatcher, offerCrashReport } from '@/data/crash';
import { handleIncomingUrl } from '@/data/links';
import { setViewing } from '@/data/activity';
import { openNotification } from '@/data/openNotification';
import { startReminders } from '@/data/reminders';

installCrashCatcher();

SplashScreen.preventAutoHideAsync();

// Tapping a notification opens what it's about, once saved chats and plans are loaded.
function useNotificationTaps(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const go = (r: Notifications.NotificationResponse | null) => {
      if (!r || r.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      Notifications.clearLastNotificationResponse();
      const data = (r.notification.request.content.data ?? {}) as Record<string, unknown>;
      // A plain "something new" (from the relay) has no data: show the list.
      setTimeout(() => { if (!openNotification(data)) openNotification({}); }, 0);
    };
    go(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [ready]);
}

function Navigator() {
  const { c, isDark } = useTheme();
  // Opening a chat or plan marks its notifications read.
  const path = usePathname();
  useEffect(() => { setViewing(path); }, [path]);
  const secure = useSecureStatus();
  useNotificationTaps(secure === 'ready' || secure === 'offline' || secure === 'unavailable');
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.surface } }}>
        <Stack.Screen name="(tabs)" />
        {['event/[id]', 'chat/[id]', 'neighborhood', 'people', 'start', 'new-chat', 'devices'].map(n => <Stack.Screen key={n} name={n} options={{ presentation: 'card' }} />)}
        <Stack.Screen name="create/index" options={{ presentation: 'modal' }} />
        <Stack.Screen name="create/[type]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="calendar-add/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="calendars" options={{ presentation: 'modal' }} />
        <Stack.Screen name="chat-info/[id]" options={{ presentation: 'modal' }} />
        {['visibility/[field]', 'my-code', 'scan', 'connect', 'phone', 'transfer', 'backup', 'subscribe', 'picture', 'blocked', 'notifications'].map(n => <Stack.Screen key={n} name={n} options={{ presentation: 'modal' }} />)}
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    AlfaSlabOne_400Regular,
    BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
    Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold, Figtree_700Bold,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync();
  }, [loaded, error]);

  // Disappearing messages: drop anything past its expiry every 30 seconds and whenever the app comes back.
  // Encrypted chats: register on first run, load saved chats, listen for messages. No-op in Expo Go.
  useEffect(() => { startSecureMessaging(); startReminders(); }, []);
  // Invite links: the full link (with the code after #) also arrives here, in case the router's copy lacks it.
  useEffect(() => {
    Linking.getInitialURL().then(handleIncomingUrl).catch(() => {});
    const sub = Linking.addEventListener('url', e => handleIncomingUrl(e.url));
    return () => sub.remove();
  }, []);
  // Asked once the encrypted vault is open (it holds any saved crash report).
  const secure = useSecureStatus();
  useEffect(() => { if (secure === 'ready') offerCrashReport(); }, [secure]);

  useEffect(() => {
    actions.pruneExpired();
    const t = setInterval(actions.pruneExpired, 30_000);
    const sub = AppState.addEventListener('change', st => { if (st === 'active') actions.pruneExpired(); });
    return () => { clearInterval(t); sub.remove(); };
  }, []);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Navigator />
        <PrivacyGuard />
        <AccountClosed />
        <Toaster />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
