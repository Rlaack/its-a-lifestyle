import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/Icon';
import { Button, IconButton, ListBox, Row, Screen, Section, T } from '@/components/ui';
import { toast } from '@/components/Toast';
import { PREF_LABELS, clearActivity, markAllRead, markRead, prefOn, removeActivity, setPref, useActivity, usePrefs, type Activity, type ActivityKind } from '@/data/activity';
import { openNotification } from '@/data/openNotification';
import { enablePush, pushAllowed } from '@/data/secure/push';
import type { IconName } from '@/theme/paths';
import { useTheme } from '@/theme/theme';

const ICON: Record<ActivityKind, IconName> = {
  message: 'chat', plan: 'cal', change: 'clock', cancel: 'x', response: 'users', reaction: 'smile', reminder: 'bell', notice: 'shield',
};

function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return new Date(t).toLocaleDateString('en-US', { weekday: 'short' });
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Everything that happened, newest first. Tap one to go to it; press and hold for more.
export default function NotificationsScreen() {
  const { c } = useTheme();
  const items = useActivity();
  usePrefs();
  const [settings, setSettings] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => { pushAllowed().then(setAllowed); };
    check();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
    return () => sub.remove();
  }, []);

  const unread = items.filter(a => !a.read);
  const earlier = items.filter(a => a.read);

  const open = (a: Activity) => {
    router.back();
    // Let the sheet close first, then go to the chat or plan.
    setTimeout(() => { if (!openNotification({ route: a.route, hood: a.hood, aid: a.id })) toast('That plan or chat isn’t here anymore.'); }, 250);
  };
  const more = (a: Activity) => {
    const opts = [a.read ? 'Mark as unread' : 'Mark as read', 'Remove', 'Cancel'];
    const pick = (i: number) => { if (i === 0) markRead(a.id, !a.read); if (i === 1) removeActivity(a.id); };
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ options: opts, destructiveButtonIndex: 1, cancelButtonIndex: 2, title: a.title }, pick);
    else Alert.alert(a.title, undefined, [{ text: opts[0], onPress: () => pick(0) }, { text: 'Remove', style: 'destructive', onPress: () => pick(1) }, { text: 'Cancel', style: 'cancel' }]);
  };
  const clearAll = () => Alert.alert('Clear all notifications?', 'This empties the list. Your chats and plans stay as they are.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear all', style: 'destructive', onPress: clearActivity },
  ]);
  const turnOn = async () => {
    const r = await enablePush();
    if (r === 'on') { setAllowed(true); toast('Notifications are on.'); } else Linking.openSettings();
  };

  const list = (xs: Activity[]) => (
    <ListBox>
      {xs.map((a, i) => (
        <Pressable key={a.id} onPress={() => open(a)} onLongPress={() => more(a)} delayLongPress={350} accessibilityRole="button"
          accessibilityLabel={`${a.read ? '' : 'Unread. '}${a.title}. ${a.body}. ${ago(a.at)}`} accessibilityHint="Opens it. Press and hold for more options."
          style={({ pressed }) => [styles.item, { borderTopColor: c.line, borderTopWidth: i === 0 ? 0 : 1, backgroundColor: pressed ? c.pineSoft : a.read ? 'transparent' : c.pineSoft + '66' }]}>
          <View style={[styles.icon, { backgroundColor: a.read ? c.surface : c.pineSoft }]}>
            <Icon name={ICON[a.kind] ?? 'bell'} size={18} color={a.kind === 'cancel' ? c.ember : c.pine} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="strong" style={{ fontSize: 15 }} numberOfLines={2}>{a.title}</T>
            <T style={{ fontSize: 14 }} numberOfLines={3}>{a.body}</T>
            <T variant="muted" style={{ fontSize: 12 }}>{ago(a.at)}{a.n && a.n > 1 ? ` · ${a.n} new` : ''}</T>
          </View>
          {!a.read && <View style={[styles.dot, { backgroundColor: c.ember }]} accessible={false} />}
        </Pressable>
      ))}
    </ListBox>
  );

  return (
    <Screen sheet title="Notifications" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      {allowed === false && (
        <View style={[styles.off, { backgroundColor: c.emberSoft, borderColor: c.ember }]}>
          <Icon name="bell" size={18} color={c.ember} />
          <View style={{ flex: 1, gap: 6 }}>
            <T variant="strong" style={{ fontSize: 14 }}>Phone notifications are off</T>
            <T style={{ fontSize: 14 }}>You’ll still see everything here, but your phone won’t tell you when something new arrives.</T>
            <Button label="Turn on notifications" onPress={turnOn} />
          </View>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button grow icon="check" label="Mark all read" onPress={() => { if (unread.length) { markAllRead(); toast('All caught up.'); } }} />
        <Button grow icon="bell" label={settings ? 'Hide settings' : 'Settings'} onPress={() => setSettings(!settings)} />
      </View>

      {settings && (
        <Section title="Notify me about">
          <ListBox>
            {PREF_LABELS.map(([k, label, hint], i) => (
              <Row key={k} first={i === 0}>
                <View style={{ flex: 1 }}>
                  <T variant="strong" style={{ fontSize: 15 }}>{label}</T>
                  <T variant="muted">{hint}</T>
                </View>
                <Switch value={prefOn(k)} onValueChange={v => setPref(k, v)} accessibilityLabel={label} trackColor={{ true: c.pine }} />
              </Row>
            ))}
          </ListBox>
          <T variant="muted">Notification text is written on this phone after your messages are decrypted. Apple and our server only ever see an empty wake-up.</T>
        </Section>
      )}

      {items.length === 0 ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 36 }}>
          <Icon name="bell" size={34} color={c.muted} />
          <T variant="strong">You’re all caught up</T>
          <T variant="muted" style={{ textAlign: 'center' }}>New messages, plans, replies to your plans and reminders show up here.</T>
        </View>
      ) : (
        <>
          {unread.length > 0 && <Section title="New">{list(unread)}</Section>}
          {earlier.length > 0 && <Section title="Earlier">{list(earlier)}</Section>}
          <Button label="Clear all" onPress={clearAll} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: 12 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  off: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1 },
});
