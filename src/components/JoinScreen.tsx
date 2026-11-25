import { useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { Button, T } from './ui';
import { actions, getState, useStore } from '@/data/store';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';
import { RelayError } from '@/data/secure/client';
import { AgreeRow } from './AgreeRow';
import { GUIDE_URL } from '@/data/security';
import { agreeToTerms, hasAgreedToTerms, getMyName, isRemoteCode, joinHoodOnline, setMyName, useSecureStatus } from '@/data/secure/sync';

// Shown when you're not in any neighborhood. Deliberately neutral: it names no neighborhood.
export function JoinScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const others = useStore(s => s.hoodList.filter(h => h.id !== s.cur && s.stash[h.id]?.hood.joined));
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const status = useSecureStatus();
  const [myName, setMyNameInput] = useState(getMyName() ?? '');
  const [busy, setBusy] = useState(false);
  const needName = status === 'ready' && !getMyName();
  const [ok, setOk] = useState(hasAgreedToTerms());
  const join = async () => {
    if (!code.trim()) return setError('Enter the join code a neighbor gave you.');
    if (!ok) return setError('Confirm you’re 18 or older and agree to the terms.');
    if (actions.joinHood(code)) return toast(`Welcome to ${getState().hood.name}`);
    if (status !== 'ready' || !isRemoteCode(code)) return setError('That code didn’t work. Check it with your neighbor.');
    if (needName) { if (!myName.trim()) return setError('Add the name neighbors will see.'); setMyName(myName); }
    setBusy(true);
    try {
      const name = await joinHoodOnline(code);
      if (!name) return setError('That code didn’t work. Check it with your neighbor.');
      agreeToTerms();
      toast(`Welcome to ${name}`);
    } catch (e) { setError(e instanceof RelayError && e.status === 402 ? 'This neighborhood is paused until someone renews its plan. Ask the neighbor who invited you.' : 'Couldn’t reach the server. Check your connection.'); }
    finally { setBusy(false); }
  };
  if (status === 'starting') {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface }}><T variant="muted">Getting things ready…</T></View>;
  }
  return (
    <ScrollView style={{ backgroundColor: c.surface }} contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 60 }]} keyboardShouldPersistTaps="handled">
      <View style={[styles.mark, { backgroundColor: c.pineSoft }]}><Icon name="home2" size={32} color={c.pine} /></View>
      <Text style={[styles.h1, { color: c.ink }]}>Join your neighborhood</Text>
      <T variant="muted">Neighborhoods are invite-only. Enter the join code a neighbor gave you, or open their invite link.</T>
      <TextInput value={code} onChangeText={t => { setCode(t); setError(''); }} placeholder="ABCD-EFGH-JKLM" placeholderTextColor={c.muted} autoCapitalize="characters" autoCorrect={false}
        style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} accessibilityLabel="Join code" onSubmitEditing={join} />
      {needName && <TextInput value={myName} onChangeText={setMyNameInput} placeholder="Your name (what neighbors see)" placeholderTextColor={c.muted} maxLength={40}
        style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink, fontSize: 16, letterSpacing: 0, fontFamily: fonts.body }]} accessibilityLabel="Your name" />}
      {!!error && <Text style={{ fontFamily: fonts.bodySemi, color: c.ember }}>{error}</Text>}
      {!hasAgreedToTerms() && <AgreeRow on={ok} onChange={v => { setOk(v); setError(''); }} />}
      <Button kind="primary" label={busy ? 'Joining…' : 'Join'} onPress={busy ? () => {} : join} />
      <Button label="Start a new neighborhood" onPress={() => router.push('/start')} />
      {!others.length && <Button label="Moving from another phone?" onPress={() => router.push('/transfer?mode=receive')} />}
      {!others.length && <Button label="Link to my account on another phone" onPress={() => router.push('/devices?mode=receive')} />}
      {!others.length && <Button label="Restore from a recovery code" onPress={() => router.push('/backup?mode=restore')} />}
      {others.map(h => <Button key={h.id} label={`Go to ${h.name}`} onPress={() => { actions.switchHood(h.id); toast(`Switched to ${h.name}`); }} />)}
      <Button label="New here? See how it works" onPress={() => Linking.openURL(GUIDE_URL)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 22, gap: 16 },
  mark: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  h1: { fontFamily: fonts.logo, fontSize: 30, lineHeight: 34 },
  input: { height: 54, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, fontSize: 20, letterSpacing: 2, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
});
