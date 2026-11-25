import { useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Screen, Section, Segmented, T } from '@/components/ui';
import { actions } from '@/data/store';
import { agreeToTerms, createHoodOnline, getMyName, hasAgreedToTerms, isRemoteCode, joinHoodOnline, setMyName, useSecureStatus } from '@/data/secure/sync';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';
import { RelayError } from '@/data/secure/client';
import { useBillingOn } from '@/data/billing';
import { AgreeRow } from '@/components/AgreeRow';
import { findJoinCode, takePendingJoin, usePendingJoin } from '@/data/links';

// Start a neighborhood (you become its owner and get a join code to share), or with ?mode=join,
// join another one with an invite code.
export default function StartNeighborhood() {
  const { c } = useTheme();
  const joining = useLocalSearchParams<{ mode?: string }>().mode === 'join';
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [places, setPlaces] = useState('');
  const [inviters, setInviters] = useState<'everyone' | 'chosen'>('everyone');
  const [error, setError] = useState('');
  const status = useSecureStatus();
  const billingOn = useBillingOn();
  const [ok, setOk] = useState(hasAgreedToTerms());
  const online = status === 'ready';
  const [myName, setMyNameInput] = useState(getMyName() ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const needName = online && !getMyName();
  const pendingJoin = usePendingJoin();
  // A join link opened the app: fill in its code (then clear it so it's used once).
  const [linkCode, setLinkCode] = useState<string | undefined>();
  if (joining && pendingJoin && pendingJoin !== linkCode) { setLinkCode(pendingJoin); setCode(pendingJoin); setError(''); }
  useEffect(() => { if (joining && pendingJoin) takePendingJoin(); }, [joining, pendingJoin]);
  const onCode = (t: string) => { setError(''); setCode(t.length > 16 ? findJoinCode(t) ?? t : t); };
  const paste = async () => {
    const found = findJoinCode(await Clipboard.getStringAsync().catch(() => ''));
    if (found) { setCode(found); setError(''); } else setError('There’s no join code on your clipboard. Copy the code or the whole invite, then tap Paste.');
  };
  const nameOk = () => { if (!needName) return true; if (!myName.trim()) { setError('Add the name neighbors will see.'); return false; } setMyName(myName); return true; };

  const join = async () => {
    if (!isRemoteCode(code)) return setError('Invite codes look like ABCD-EFGH-JKLM.');
    if (!ok) return setError('Confirm you’re 18 or older and agree to the terms.');
    if (!nameOk()) return;
    setBusy(true);
    try {
      const hoodName = await joinHoodOnline(code);
      if (!hoodName) return setError('That code didn’t work. Check it with your neighbor.');
      agreeToTerms();
      router.dismissAll();
      toast(`Welcome to ${hoodName}`);
    } catch (e) { setError(e instanceof RelayError && e.status === 402 ? 'This neighborhood is paused until someone renews its plan. Ask the neighbor who invited you.' : 'Couldn’t reach the server. Check your connection.'); }
    finally { setBusy(false); }
  };
  const input = [styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }];

  const create = async () => {
    if (!name.trim()) return setError('Give your neighborhood a name.');
    if (!ok) return setError('Confirm you’re 18 or older and agree to the terms.');
    if (!nameOk()) return;
    let remoteCode: string | undefined;
    if (online) {
      setBusy(true);
      try { remoteCode = await createHoodOnline(name.trim(), { about: about.trim(), places: places.split(',').map(x => x.trim()).filter(Boolean), inviters }); }
      catch (e) {
        setBusy(false);
        if (e instanceof RelayError && e.status === 402) { setError(''); return router.push('/subscribe'); }
        if (e instanceof RelayError && e.status === 409 && e.body.error === 'subscription full') return setError('Your plan already covers 3 neighborhoods. Leave or delete one to start another.');
        return setError('Couldn’t reach the server. Check your connection.');
      }
      setBusy(false);
    }
    agreeToTerms();
    actions.createHood({ name: name.trim(), about: about.trim(), places: places.split(',').map(x => x.trim()).filter(Boolean), inviters, remoteCode });
    router.dismissAll();
    router.push('/neighborhood');
    toast(`${name.trim()} is ready. Share the join code to invite neighbors.`);
  };

  return (
    <Screen back title={joining ? 'Join a neighborhood' : 'Start a neighborhood'}>
      {joining && <>
        <T variant="muted">Tap the invite link a neighbor sent you, or paste or type their join code.</T>
        <Section title="Invite code">
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput value={code} onChangeText={onCode} placeholder="ABCD-EFGH-JKLM" placeholderTextColor={c.muted} autoCapitalize="characters" autoCorrect={false} style={[input, { flex: 1 }]} accessibilityLabel="Invite code" />
            <Button label="Paste" onPress={paste} />
          </View>
        </Section>
        {!online && <T variant="muted">Connecting… joining needs a connection.</T>}
      </>}
      {needName && (
        <Section title="Your name">
          <TextInput value={myName} onChangeText={setMyNameInput} placeholder="First name and last initial" placeholderTextColor={c.muted} maxLength={40} style={input} accessibilityLabel="Your name" />
          <T variant="muted">What neighbors see. It’s encrypted, so our server can’t read it.</T>
        </Section>
      )}
      {!joining && <>
      <T variant="muted">{billingOn ? 'Owning a neighborhood takes a yearly plan. Neighbors you invite join free. ' : ''}You’ll be the owner. Only people you and your members invite can see anything inside it.</T>
      <Section title="Name"><TextInput value={name} onChangeText={setName} accessibilityLabel="Neighborhood name" placeholder="Fox Run" placeholderTextColor={c.muted} style={input} /></Section>
      <Section title="Short description (optional)">
        <TextInput value={about} onChangeText={setAbout} accessibilityLabel="Short description, optional" placeholder="What makes it home" placeholderTextColor={c.muted} multiline style={[input, { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }]} />
      </Section>
      <Section title="Common places (optional)">
        <TextInput value={places} onChangeText={setPlaces} accessibilityLabel="Common places, separated by commas, optional" placeholder="Pool, Park, Clubhouse" placeholderTextColor={c.muted} style={input} />
        <T variant="muted">Separate with commas. Neighbors can pick these when they plan something.</T>
      </Section>
      <Section title="Who can invite">
        <Segmented small options={[['everyone', 'Every member'], ['chosen', 'People I choose']]} value={inviters} onChange={setInviters} />
        <T variant="muted">You can change this later.</T>
      </Section>
      </>}
      {!hasAgreedToTerms() && <AgreeRow on={ok} onChange={v => { setOk(v); setError(''); }} />}
      {!!error && <Text style={{ fontFamily: fonts.bodySemi, color: c.ember }}>{error}</Text>}
      {joining
        ? <Button kind="primary" label={busy ? 'Joining…' : 'Join'} onPress={busy || !online ? () => {} : join} />
        : <Button kind="primary" label={busy ? 'Creating…' : 'Create neighborhood'} onPress={busy ? () => {} : create} />}
      <Button label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 46, fontFamily: fonts.body, fontSize: 15 },
});
