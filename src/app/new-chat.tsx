import { ENCRYPTION_LIVE } from '@/data/security';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/Icon';
import { Avatar, Button, ListBox, Pick, Row, Screen, Section, T } from '@/components/ui';
import { actions, groupIn, useStore } from '@/data/store';
import { toast } from '@/components/Toast';
import { chatByPhone, createGroupChat, openSecureChat, phoneEnabled, useSecureStatus } from '@/data/secure/sync';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Start a one-on-one or group chat. Ported from the prototype's vNewChat.
export default function NewChat() {
  const { c } = useTheme();
  const members = useStore(s => s.hood.members);
  const allGroups = useStore(s => s.groups);
  const favorites = useStore(s => s.favorites);
  const verified = useStore(s => s.verified);
  const everyone = members.map(m => m.n).filter(n => n !== 'You');
  const groups = allGroups.filter(g => g.members.length > 0 && g.members.every(n => everyone.includes(n)));
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const status = useSecureStatus();
  const [phone, setPhone] = useState('');
  const [phoneName, setPhoneName] = useState('');
  const [busy, setBusy] = useState(false);
  const accountOf = (n: string) => members.find(m => m.n === n)?.account;
  const findPhone = async () => {
    setBusy(true); const r = await chatByPhone(phone, phoneName); setBusy(false);
    if (!r.ok) return toast(r.reason);
    router.replace(`/chat/${r.chatId}`);
  };
  const query = q.trim().toLowerCase();
  const list = query ? everyone.filter(n => n.toLowerCase().includes(query)) : everyone;
  const toggle = (n: string) => setSel(s => (s.includes(n) ? s.filter(x => x !== n) : [...s, n]));
  const toggleGroup = (i: number) => { const g = groups[i]; setSel(s => (groupIn(g, s) ? s.filter(n => !g.members.includes(n)) : [...new Set([...s, ...g.members])])); };

  const start = () => {
    if (!sel.length) return;
    // Real neighbors (joined with the invite code) get an end-to-end encrypted chat.
    const real = sel.map(accountOf);
    if (real.some(Boolean)) {
      if (real.some(a => !a)) return toast('Some of these people aren’t on the app yet. Pick people from your real neighborhood.');
      const sid = sel.length > 1
        ? createGroupChat(name.trim() || sel.slice(0, 3).join(', ') + (sel.length > 3 ? ` +${sel.length - 3}` : ''), real as string[], sel, !!name.trim())
        : openSecureChat(real[0]!, sel[0], 'neighborhood');
      router.replace(`/chat/${sid}`);
      return;
    }
    const id = actions.createChat(sel, name);
    router.replace(`/chat/${id}`);
  };

  return (
    <Screen back title="New chat">
      {sel.length ? (
        <View style={styles.chips}>{sel.map(n => <Pick key={n} label={`${n} ×`} on onPress={() => toggle(n)} />)}</View>
      ) : <T variant="muted">Pick one neighbor for a direct message, or a few for a group chat.</T>}
      {status !== 'unavailable' && (
        <Section title="Someone not listed here?">
          {phoneEnabled && <TextInput value={phone} onChangeText={setPhone} placeholder="Their phone number" placeholderTextColor={c.muted} keyboardType="phone-pad" accessibilityLabel="Their phone number"
            style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />}
          {!!phone.trim() && <TextInput value={phoneName} onChangeText={setPhoneName} placeholder="Their name (just for you)" placeholderTextColor={c.muted} accessibilityLabel="Their name"
            style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />}
          {!!phone.trim() && <Button kind="primary" label={busy ? 'Looking…' : 'Find on the app'} onPress={busy ? () => {} : findPhone} />}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button grow icon="users" label="Scan their code" onPress={() => router.push('/scan')} />
            <Button grow icon="send" label="Invite link" onPress={() => router.push('/my-code')} />
          </View>
        </Section>
      )}
      <TextInput value={q} onChangeText={setQ} placeholder="Search neighbors" placeholderTextColor={c.muted} accessibilityLabel="Search neighbors"
        style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />
      {!query && groups.length > 0 && (
        <Section title="Your groups"><View style={styles.chips}>{groups.map((g, i) => <Pick key={g.name} label={`${g.name} · ${g.members.length}`} on={groupIn(g, sel)} onPress={() => toggleGroup(i)} />)}</View></Section>
      )}
      {!query && favorites.some(n => everyone.includes(n)) && (
        <Section title="Favorites"><View style={styles.chips}>{favorites.filter(n => everyone.includes(n)).map(n => <Pick key={n} label={n} on={sel.includes(n)} onPress={() => toggle(n)} />)}</View></Section>
      )}
      <ListBox>
        {list.map((n, i) => (
          <Row key={n} first={i === 0} onPress={() => toggle(n)}>
            <Avatar name={n} size={40} ring={false} />
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <T variant="strong" style={{ fontSize: 15 }}>{n}</T>
              {ENCRYPTION_LIVE && verified.includes(n) && <Icon name="check" size={14} color={c.pine} />}
            </View>
            <View style={[styles.box, { borderColor: sel.includes(n) ? c.pine : c.line, backgroundColor: sel.includes(n) ? c.pine : 'transparent' }]}>
              {sel.includes(n) && <Icon name="check" size={14} color={c.onPine} />}
            </View>
          </Row>
        ))}
        {!list.length && <Row first><T variant="muted">No neighbors match.</T></Row>}
      </ListBox>
      {sel.length > 1 && (
        <Section title="Group chat name (optional)">
          <TextInput value={name} onChangeText={setName} accessibilityLabel="Group chat name" placeholder="Dock crew" placeholderTextColor={c.muted} style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />
        </Section>
      )}
      <Button kind="primary" label={sel.length ? `Start chat with ${sel.length === 1 ? sel[0] : `${sel.length} people`}` : 'Start chat'} onPress={() => start()} />
      <Pressable onPress={() => router.back()} accessibilityRole="button"><T variant="muted" style={{ textAlign: 'center' }}>Cancel</T></Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 44, fontFamily: fonts.body, fontSize: 15 },
  box: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
