import { useEffect, useState } from 'react';
import { Share, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Button, IconButton, Notice, Screen, T } from '@/components/ui';
import { getMyName, myConnectCode, myInviteLink, setMyName, useSecureStatus } from '@/data/secure/sync';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Your connect code. A neighbor scans it in person: you're connected, and their phone pins your
// encryption key, so nobody (not even our server) can slip in a different one later.
// The code holds your random account ID, your public identity key and the name you choose here.
export default function MyCode() {
  const { c } = useTheme();
  const status = useSecureStatus();
  const [name, setName] = useState(getMyName() ?? '');
  const [code, setCode] = useState<string | null>(null);
  const [editing, setEditing] = useState(!getMyName());

  useEffect(() => {
    if (status !== 'ready' || editing) return;
    let live = true;
    myConnectCode().then(v => { if (live) setCode(v); });
    return () => { live = false; };
  }, [status, editing]);

  const saveName = () => { if (!name.trim()) return; setMyName(name); setEditing(false); };

  return (
    <Screen sheet title="Your connect code" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      {status === 'unavailable' && <Notice icon="shield" title="Not available in this preview">Encrypted chat needs the full app build. In the preview app this screen can’t make a real code.</Notice>}
      {status === 'starting' && <T variant="muted">Setting up your encryption keys…</T>}
      {status === 'offline' && <Notice icon="shield" title="Can’t reach the server">Your code needs a connection the first time. Check your internet and try again.</Notice>}
      {status === 'ready' && editing && <>
        <T>What name should neighbors see when they connect with you?</T>
        <TextInput value={name} onChangeText={setName} placeholder="First name and last initial" placeholderTextColor={c.muted} maxLength={40}
          autoFocus onSubmitEditing={saveName} returnKeyType="done" accessibilityLabel="Your name"
          style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />
        <T variant="muted">It’s only in your code and inside encrypted messages. Our server never sees it.</T>
        <Button kind="primary" label="Show my code" onPress={saveName} />
      </>}
      {status === 'ready' && !editing && code && <>
        <View accessible accessibilityRole="image" accessibilityLabel="Your connection code, for a neighbor to scan" style={{ alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: c.line }}>
          <QRCode value={code} size={240} color="#1D2C25" backgroundColor="#FFFFFF" ecl="M" />
        </View>
        <T variant="muted" style={{ textAlign: 'center' }}>Hold this up for a neighbor to scan. You’ll be connected and verified, with no numbers to compare.</T>
        <Button icon="send" label="Send an invite link instead" onPress={async () => {
          const link = await myInviteLink();
          if (link) Share.share({ message: `Let’s chat on It’s a Lifestyle (end-to-end encrypted): ${link}` });
        }} />
        <T variant="muted">A link works when you can’t meet, but only send it to people you trust: anyone who has it can message you.</T>
        <Button label={`Change name (${getMyName()})`} onPress={() => setEditing(true)} />
      </>}
      <Button kind={status === 'ready' && !editing ? 'primary' : 'default'} icon="users" label="Scan a neighbor’s code" onPress={() => router.replace('/scan')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 44, fontFamily: fonts.body, fontSize: 15 },
});
