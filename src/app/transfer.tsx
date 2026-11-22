import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Button, IconButton, Notice, Screen, T } from '@/components/ui';
import { toast } from '@/components/Toast';
import { moveAccountOut, prepareMoveIn } from '@/data/secure/sync';

// Moving an account to a new phone.
//  ?mode=receive  the new phone: shows a QR code and waits.
//  ?code=…        the old phone, after scanning that code: sends everything, then empties itself.
export default function Transfer() {
  const { mode, code } = useLocalSearchParams<{ mode?: string; code?: string }>();
  return mode === 'receive' ? <Receive /> : <Send code={String(code ?? '')} />;
}

function Receive() {
  const [prep] = useState(() => prepareMoveIn());
  // Simulators can't scan with the camera; development builds log the code so it can be opened as a link.
  useEffect(() => { if (__DEV__) console.log('[transfer] code', prep.qr); }, [prep]);
  const [step, setStep] = useState('Waiting for your old phone to scan this code…');
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  useEffect(() => {
    prep.wait(setStep, () => cancelled.current)
      .then(ok => { if (ok) { router.dismissAll(); toast('Welcome back. Your account is on this phone now.'); } })
      .catch(e => setError(e instanceof Error ? e.message : 'Something went wrong. Try again.'));
    return () => { cancelled.current = true; };
  }, [prep]);
  return (
    <Screen sheet title="Move from your old phone" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <T variant="muted">On your old phone, open It’s a Lifestyle, go to Me → Move to a new phone, and scan this code. Keep both phones open and nearby.</T>
      <View style={{ alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF', borderRadius: 18 }} accessible accessibilityRole="image" accessibilityLabel="Transfer code for your old phone to scan">
        <QRCode value={prep.qr} size={240} color="#1D2C25" backgroundColor="#FFFFFF" ecl="M" />
      </View>
      {error ? <Notice icon="shield" title="That didn’t work">{error}</Notice> : <T variant="strong">{step}</T>}
      <Notice icon="lock" title="Private">Everything is encrypted with a key that’s only in this code. Our server passes it along but can’t read it. Don’t show this code to anyone else.</Notice>
    </Screen>
  );
}

function Send({ code }: { code: string }) {
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState(false);
  const go = () => Alert.alert('Move your account?', 'Your neighborhoods, chats and keys go to the new phone. When it’s done, this phone is emptied.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Move', onPress: async () => {
      setBusy(true);
      try {
        const r = await moveAccountOut(code, setStep);
        if (r === 'moved') { router.dismissAll(); toast('Moved. Your account is on your new phone now, and this phone is empty.'); }
        else { setBusy(false); setStep('Your new phone didn’t pick it up in time. Nothing changed here; try again.'); }
      } catch (e) { setBusy(false); setStep(e instanceof Error ? e.message : 'Couldn’t reach the server. Nothing changed.'); }
    } },
  ]);
  return (
    <Screen sheet title="Move to a new phone" right={busy ? undefined : <IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <T variant="muted">This sends your account to the new phone that showed the code. Only one phone can use your account, so this one will be emptied when the move is done.</T>
      <Notice icon="lock" title="Encrypted">Your chats and keys are encrypted with the key in that code before they leave this phone.</Notice>
      {!!step && <T variant="strong">{step}</T>}
      {!busy && <Button kind="primary" label="Move my account" onPress={go} />}
      {!busy && <Button label="Cancel" onPress={() => router.back()} />}
    </Screen>
  );
}
