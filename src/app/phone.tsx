import { useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { router } from 'expo-router';
import { toast } from '@/components/Toast';
import { Button, IconButton, Notice, Screen, T } from '@/components/ui';
import { forgetMyPhone, getMyPhone, sendPhoneCode, useSecureStatus, useSecureVersion, verifyPhoneCode } from '@/data/secure/sync';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Add your phone number so neighbors who know it can find you (like Signal). Optional.
export default function Phone() {
  const { c } = useTheme();
  const status = useSecureStatus();
  useSecureVersion();
  const mine = getMyPhone();
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const field = [styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }];

  const send = async () => {
    setBusy(true); const r = await sendPhoneCode(input); setBusy(false);
    if (!r.ok) return toast(r.reason);
    setPending(r.phone!); toast('We texted you a 6-digit code.');
  };
  const verify = async () => {
    if (!pending) return;
    setBusy(true); const r = await verifyPhoneCode(pending, code); setBusy(false);
    if (!r.ok) return toast(r.reason);
    toast('Your number is added. Neighbors who have it can now find you.'); router.back();
  };

  return (
    <Screen sheet title="Phone number" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      {status !== 'ready' && <Notice icon="shield" title="Not available right now">{status === 'unavailable' ? 'This needs the full app build.' : 'Can’t reach the server. Check your connection.'}</Notice>}
      <T variant="muted">Optional. Adding your number lets neighbors who already have it start an encrypted chat with you. Our server keeps it as a scrambled fingerprint, not the digits, and never shows it to anyone.</T>
      {mine && !pending ? <>
        <T variant="strong">Your number: {mine}</T>
        <Button label="Remove my number" onPress={async () => { await forgetMyPhone(); toast('Removed. People can’t find you by number anymore.'); }} />
      </> : !pending ? <>
        <TextInput value={input} onChangeText={setInput} placeholder="(555) 555-0123" placeholderTextColor={c.muted} keyboardType="phone-pad" textContentType="telephoneNumber" style={field} accessibilityLabel="Your phone number" />
        <Button kind="primary" label={busy ? 'Sending…' : 'Text me a code'} onPress={busy || status !== 'ready' ? () => {} : send} />
      </> : <>
        <T>Enter the code we texted to {pending}.</T>
        <TextInput value={code} onChangeText={setCode} placeholder="123456" placeholderTextColor={c.muted} keyboardType="number-pad" textContentType="oneTimeCode" maxLength={6} style={field} accessibilityLabel="Verification code" />
        <Button kind="primary" label={busy ? 'Checking…' : 'Confirm'} onPress={busy ? () => {} : verify} />
        <Button label="Use a different number" onPress={() => { setPending(null); setCode(''); }} />
      </>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 48, fontFamily: fonts.body, fontSize: 17 },
});
