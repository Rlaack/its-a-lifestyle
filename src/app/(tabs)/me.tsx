import { useBillingOn } from '@/data/billing';
import { Alert, Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/Icon';
import { Avatar, Button, Chip, ListBox, Row, Screen, Section, Segmented, T } from '@/components/ui';
import { actions, useStore , inviteSummary } from '@/data/store';
import type { IconName } from '@/theme/paths';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';
import { deleteMyAccount, getMyName, phoneEnabled, supportId, useSecureStatus, useSecureVersion, isLinkedDevice, unlinkThisDevice } from '@/data/secure/sync';
import * as Clipboard from 'expo-clipboard';
import { SUPPORT_EMAIL, SUPPORT_PHONE } from '@/data/security';
import { lockNow } from '@/components/PrivacyGuard';

const FIELDS: { k: 'phone' | 'address' | 'location'; icon: IconName; label: string; hint: string; opts: string[] }[] = [
  { k: 'phone', icon: 'phone', label: 'Phone number', hint: 'Only used so neighbors can call you', opts: ['Nobody', 'Connections', 'Everyone', 'Pick people'] },
  { k: 'address', icon: 'home2', label: 'Address', hint: 'Until you share it, neighbors only see your road', opts: ['Nobody', 'Connections', 'Everyone', 'Pick people'] },
  { k: 'location', icon: 'pin', label: 'Location', hint: 'Never tracked in the background', opts: ['Off', 'During events', 'Pick people'] },
];

export default function MeScreen() {
  const billingOn = useBillingOn();
  const { c } = useTheme();
  const me = useStore(s => s.me);
  const hood = useStore(s => s.hood);
  const favCount = useStore(s => s.favorites.length);
  const groupCount = useStore(s => s.groups.length);
  const hoodList = useStore(s => s.hoodList);
  const cur = useStore(s => s.cur);
  useSecureVersion();
  const status = useSecureStatus();
  const myName = getMyName();
  const linked = isLinkedDevice();
  const confirmUnlink = () => Alert.alert('Remove this device?', 'This erases your keys and messages from this device. Your account stays on your phone.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => {
      try { await unlinkThisDevice(); toast('This device was removed.'); router.replace('/'); }
      catch { toast('Couldn’t reach the server. Nothing changed.'); }
    } }]);
  const confirmDelete = () => Alert.alert('Delete your account?',
    'This erases your account on our server, your phone number if you added one, your place in every neighborhood, and all your keys and messages on this phone. Neighbors keep what you already sent them. If you have a subscription, cancel it in your App Store settings too; deleting your account doesn’t stop Apple’s billing. This can’t be undone.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete everything', style: 'destructive', onPress: async () => {
      try { await deleteMyAccount(); toast('Your account was deleted.'); router.replace('/'); }
      catch (e) { if (__DEV__) console.log('[groups] delete failed', String(e)); toast('Couldn’t reach the server, so nothing was deleted. Try again when you’re online.'); }
    } }]);
  const chevron = <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="back" color={c.muted} size={18} /></View>;
  return (
    <Screen title="Me">
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <Avatar name="You" size={72} ring={false} />
        <View>
          <T variant="heading">{myName ?? 'Your name'}</T>
          <T variant="muted">{[hood.name, me.street].filter(Boolean).join(' · ')}</T>
        </View>
      </View>

      <Section title="Neighborhoods">
        <ListBox>
          {hoodList.map((h, i) => (
            <Row key={h.id} first={i === 0} onPress={() => { if (h.id === cur) router.push('/neighborhood'); else { actions.switchHood(h.id); toast(`Switched to ${h.name}`); } }}>
              <Icon name="home2" color={c.ink} />
              <View style={{ flex: 1 }}>
                <T variant="strong" style={{ fontSize: 15 }}>{h.name}</T>
                <T variant="muted">{h.id === cur ? 'Invite people, see members, settings' : 'Tap to switch'}</T>
              </View>
              {h.id === cur && <Chip label="Current" tone="pine" />}
            </Row>
          ))}
          <Row onPress={() => router.push('/start?mode=join')}>
            <Icon name="plus" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Join with an invite code</T><T variant="muted">A neighbor gives you the code</T></View>
          </Row>
          <Row onPress={() => router.push('/start')}>
            <Icon name="plus" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Start a new neighborhood</T><T variant="muted">You’ll be the owner</T></View>
          </Row>
          {billingOn && <Row onPress={() => router.push('/subscribe')}>
            <Icon name="shield" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Neighborhood plan</T><T variant="muted">Subscribe, restore or manage</T></View>
          </Row>}
        </ListBox>
      </Section>

      <Section title="People">
        <ListBox>
          <Row first onPress={() => router.push('/people')}>
            <Icon name="star" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Favorites and groups</T><T variant="muted">{favCount} favorites · {groupCount} groups</T></View>
            {chevron}
          </Row>
        </ListBox>
      </Section>

      <Section title="Who can see what">
        <ListBox>
          {FIELDS.map((f, i) => (
            <View key={f.k} style={{ padding: 14, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Icon name={f.icon} color={c.ink} />
                <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>{f.label}</T><T variant="muted">{f.hint}</T></View>
              </View>
              <Segmented small options={f.opts.map(o => [o, o] as [string, string])} value={me.vis[f.k]}
                onChange={v => { if (v === 'Pick people') router.push(`/visibility/${f.k}`); else { actions.setVisibility(f.k, v); toast(`${f.label}: ${v}`); } }} />
              {me.vis[f.k] === 'Pick people' && (
                <Pressable onPress={() => router.push(`/visibility/${f.k}`)} accessibilityRole="button" style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                  <T variant="muted" numberOfLines={1} style={{ flex: 1 }}>Shown to: {inviteSummary(me.visPeople?.[f.k] ?? []) || 'no one yet'}</T>
                  <T variant="small" style={{ color: c.pine, textDecorationLine: 'underline' }}>Change</T>
                </Pressable>
              )}
            </View>
          ))}
        </ListBox>
      </Section>

      <Section title="Reminders">
        <ListBox>
          <View style={{ padding: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon name="bell" color={c.ink} />
              <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>When you say you’re going</T><T variant="muted">Default reminder. You can change it on any event.</T></View>
            </View>
            <Segmented small options={[['None', 'None'], ['Day before', 'Day before'], ['Morning of', 'Morning of']]} value={me.remindDefault} onChange={v => { actions.setRemindDefault(v); toast(`Default reminder: ${v.toLowerCase()}`); }} />
          </View>
          <View style={{ padding: 14, gap: 8, borderTopWidth: 1, borderTopColor: c.line }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon name="cal" color={c.ink} />
              <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Add to calendar</T><T variant="muted">Where “Add to your calendar” saves plans</T></View>
            </View>
            <Segmented small options={[['ask', 'Ask each time'], ['phone', 'Phone calendar'], ['google', 'Google Calendar']]} value={me.calPref ?? 'ask'}
              onChange={v => actions.setCalPref(v === 'ask' ? null : v)} />
          </View>
        </ListBox>
      </Section>

      <Section title="Phone security">
        <ListBox>
          <Row first>
            <Icon name="lock" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>App lock</T><T variant="muted">Face ID or fingerprint to open the app</T></View>
            <Toggle on={me.sec.lock} label="App lock" onPress={() => { actions.setSecurity('lock', !me.sec.lock); toast(me.sec.lock ? 'App lock is off' : 'App lock is on'); }} />
          </Row>
          {me.sec.lock && <Row onPress={lockNow}><Icon name="shield" color={c.ink} /><View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Lock now</T><T variant="muted">See what opening the app looks like</T></View></Row>}
          <Row>
            <Icon name="eyeoff" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Hide chats in app switcher</T><T variant="muted">Covers the app when you switch apps, so nobody reads over your shoulder</T></View>
            <Toggle on={me.sec.blur} label="Hide chats in app switcher" onPress={() => { actions.setSecurity('blur', !me.sec.blur); toast(me.sec.blur ? 'Chats show in the app switcher' : 'Chats are hidden in the app switcher'); }} />
          </Row>
          <Row onPress={() => router.push('/devices')}>
            <Icon name="phone" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Linked devices</T><T variant="muted">{linked ? 'This device is linked to your phone' : 'Use your account on up to 2 more devices'}</T></View>
            {chevron}
          </Row>
          <Row>
            <Icon name="shield" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Phone check</T><T variant="muted">Warns you if this phone is jailbroken or rooted, or out of date. Runs in the installed app.</T></View>
          </Row>
        </ListBox>
      </Section>

      <Section title="Keeping it private">
        <ListBox>
          <Row first onPress={() => router.push('/my-code')}>
            <Icon name="users" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Show my code</T><T variant="muted">A neighbor scans it to connect and verify</T></View>
            {chevron}
          </Row>
          {phoneEnabled && <Row onPress={() => router.push('/phone')}>
            <Icon name="phone" color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Phone number</T><T variant="muted">Optional. Lets neighbors who have it find you</T></View>
            {chevron}
          </Row>}
        </ListBox>
      </Section>

      <Section title="What we keep">
        <ListBox>
          {[
            ['check', 'A random account ID and your public encryption keys', true],
            ['check', 'Which neighborhoods you’re in, but not their names or yours (those are encrypted)', true],
            ['check', 'Your phone number, only if you add it, stored scrambled', true],
            ['check', 'Encrypted messages until your phone picks them up, then they’re deleted', true],
            ['x', 'Your name, your messages, plans or chats in readable form', false],
            ['x', 'Your contacts, browsing, or location history', false],
            ['x', 'Ads, trackers, or data sold to anyone. Ever.', false],
          ].map(([icon, text, yes], i) => (
            <Row key={i} first={i === 0}>
              <Icon name={icon as IconName} size={16} color={yes ? c.pine : c.muted} />
              <T variant={yes ? 'body' : 'muted'} style={{ flex: 1 }}>{text as string}</T>
            </Row>
          ))}
        </ListBox>
      </Section>

      <Section title="Your account">
        {!linked && <>
        <Pressable onPress={() => Alert.alert('Move to a new phone', 'On the new phone, install It’s a Lifestyle and tap “Moving from another phone?”. Then scan the code it shows.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Scan the code', onPress: () => router.push('/scan') }])} accessibilityRole="button" style={{ paddingVertical: 6 }}>
          <T variant="strong" style={{ color: c.pine }}>Move to a new phone</T>
        </Pressable>
        <Pressable onPress={() => router.push('/backup')} accessibilityRole="button" style={{ paddingVertical: 6 }}>
          <T variant="strong" style={{ color: c.pine }}>Recovery backup</T>
        </Pressable>
        </>}
        {!!supportId() && <Pressable onPress={() => { Clipboard.setStringAsync(supportId()!); toast('Support ID copied'); }} accessibilityRole="button" accessibilityHint="Copies your support ID">
          <T variant="muted">Support ID: <T variant="strong">{supportId()}</T> (tap to copy). Give this if you contact support.</T>
        </Pressable>}
        <Pressable onPress={() => Alert.alert('Contact support', `Email ${SUPPORT_EMAIL} or call or text (929) 260-1089.${supportId() ? ` Mention your support ID, ${supportId()}.` : ''}`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call or text', onPress: () => Linking.openURL(`tel:${SUPPORT_PHONE}`) },
          { text: 'Email', onPress: () => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('It’s a Lifestyle support')}&body=${encodeURIComponent(supportId() ? `Support ID: ${supportId()}\n\n` : '')}`) },
        ])} accessibilityRole="button" style={{ paddingVertical: 6 }}>
          <T variant="strong" style={{ color: c.pine }}>Contact support</T>
        </Pressable>
        <T variant="muted">Deleting your account erases it from our server and wipes this phone’s keys and messages.</T>
        {linked
          ? <Button kind="danger" label="Remove this device" onPress={confirmUnlink} />
          : <Button kind="danger" label="Delete my account" onPress={status === 'unavailable' ? () => toast('This needs the full app build.') : confirmDelete} />}
      </Section>
    </Screen>
  );
}

function Toggle({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on }}
      style={{ width: 50, height: 30, borderRadius: 15, backgroundColor: on ? c.pine : c.line, padding: 3, alignItems: on ? 'flex-end' : 'flex-start' }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.card }} />
    </Pressable>
  );
}
