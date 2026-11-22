import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Button, IconButton, Notice, Screen, T } from '@/components/ui';
import { toast } from '@/components/Toast';
import { backupStatus, looksLikeRecoveryCode, restoreFromBackup, turnOffBackup, turnOnBackup } from '@/data/secure/sync';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Recovery backup.
//  default         Me → Recovery backup: turn it on (shows the code once), replace the code, or turn it off.
//  ?mode=restore   A new phone: enter the code to restore.
export default function Backup() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  return mode === 'restore' ? <Restore /> : <Setup />;
}

function Setup() {
  const { c } = useTheme();
  const [status, setStatus] = useState<{ on: boolean; last?: number } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { backupStatus().then(setStatus); }, []);
  const start = async () => {
    setBusy(true);
    try { setCode(await turnOnBackup()); setStatus({ on: true, last: Date.now() }); }
    catch (e) { toast(e instanceof Error && !/relay/.test(e.message) ? e.message : 'Couldn’t reach the server. Nothing changed.'); }
    finally { setBusy(false); }
  };
  const off = () => Alert.alert('Turn off the backup?', 'The backup is deleted from our server. If you lose this phone, your account can’t be restored.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Turn off', style: 'destructive', onPress: async () => { await turnOffBackup(); setStatus({ on: false }); toast('Backup turned off and deleted.'); } },
  ]);
  const replace = () => Alert.alert('Make a new recovery code?', 'The old code stops working. Write down the new one.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'New code', onPress: start },
  ]);

  if (code) {
    return (
      <Screen sheet title="Your recovery code" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
        <T variant="muted">Write this down and keep it somewhere safe, away from your phone. It’s the only way to restore your account, and we can’t show it again or recover it for you.</T>
        <View style={[styles.code, { backgroundColor: c.pineSoft }]} accessible accessibilityLabel={`Recovery code: ${code.split('').join(' ')}`}>
          <Text selectable style={[styles.codeText, { color: c.pine }]}>{code}</Text>
        </View>
        <Notice icon="shield" title="Keep it private">Anyone with this code can restore your account on their phone. Don’t share it, screenshot it or store it in your notes.</Notice>
        <Button label="Copy (then paste it into a password manager)" onPress={async () => { await Clipboard.setStringAsync(code); toast('Copied. Paste it somewhere safe, then clear your clipboard.'); }} />
        <Button kind="primary" label="I wrote it down" onPress={() => router.back()} />
      </Screen>
    );
  }
  return (
    <Screen sheet title="Recovery backup" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <T variant="muted">If you lose your phone, a recovery code brings your account back on a new one: your neighborhoods, chats, plans and settings. Photos and files aren’t included.</T>
      <Notice icon="lock" title="Encrypted with your code">Your backup is encrypted on this phone with a key made from your recovery code. Our server stores only the scrambled copy and never sees the code.</Notice>
      {status?.on
        ? <>
            <T variant="strong">Backup is on{status.last ? ` · last saved ${new Date(status.last).toLocaleDateString()}` : ''}</T>
            <T variant="muted">It updates itself once a day while you use the app.</T>
            <Button label={busy ? 'Working…' : 'Make a new recovery code'} onPress={busy ? () => {} : replace} />
            <Button label="Turn off and delete the backup" onPress={off} />
          </>
        : status && <Button kind="primary" label={busy ? 'Setting up…' : 'Turn on recovery backup'} onPress={busy ? () => {} : start} />}
      <T variant="muted">Moving to a new phone you still have? Use Me → Move to a new phone instead. It brings your photos too.</T>
    </Screen>
  );
}

function Restore() {
  const { c } = useTheme();
  const [code, setCode] = useState('');
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!looksLikeRecoveryCode(code)) return setStep('Recovery codes are 24 letters and numbers, like ABCD-EFGH-….');
    setBusy(true);
    try { await restoreFromBackup(code, setStep); router.dismissAll(); toast('Welcome back. Your neighbors’ phones are reconnecting with this one.'); }
    catch (e) { setStep(e instanceof Error && !/relay/.test(e.message) ? e.message : 'Couldn’t reach the server. Try again.'); }
    finally { setBusy(false); }
  };
  return (
    <Screen sheet title="Restore your account" right={busy ? undefined : <IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <T variant="muted">Enter the recovery code you wrote down when you turned on the backup.</T>
      <TextInput value={code} onChangeText={t => { setCode(t); setStep(''); }} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" placeholderTextColor={c.muted}
        autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Recovery code" editable={!busy}
        style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />
      {!!step && <T variant="strong">{step}</T>}
      <Button kind="primary" label={busy ? 'Restoring…' : 'Restore'} onPress={busy ? () => {} : go} />
      <T variant="muted">Your neighbors’ phones reconnect with this one automatically. Messages sent while you had no phone may not come back.</T>
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { padding: 18, borderRadius: 18, alignItems: 'center' },
  codeText: { fontFamily: 'Menlo', fontSize: 20, letterSpacing: 1.5, fontWeight: '700', textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 46, fontFamily: fonts.body, fontSize: 16, letterSpacing: 1 },
});
