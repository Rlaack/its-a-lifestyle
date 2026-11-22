import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { Button, Chip, ListBox, Notice, Row, Screen, T } from '@/components/ui';
import { isLinkedDevice, linkDevice, myDevices, prepareLinkIn, removeLinkedDevice } from '@/data/secure/sync';
import { RelayError, type LinkedDevice } from '@/data/secure/client';
import { useTheme } from '@/theme/theme';

// Linked devices: your phone plus up to 2 more.
//  default         the list
//  ?mode=receive   a new device: shows a code for your phone to scan
//  ?code=…         your phone, after scanning that code: approve it
export default function Devices() {
  const { mode, code } = useLocalSearchParams<{ mode?: string; code?: string }>();
  if (mode === 'receive') return <Receive />;
  if (code) return <Approve code={String(code)} />;
  return <List />;
}

const label = (n: number) => (n === 1 ? 'Your phone' : `Linked device ${n - 1}`);

function List() {
  const { c } = useTheme();
  const [info, setInfo] = useState<{ me: number; limit: number; devices: LinkedDevice[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => { myDevices().then(r => { setInfo(r); setFailed(false); }).catch(() => setFailed(true)); }, []);
  useEffect(load, [load]);
  const remove = (n: number) => Alert.alert(`Remove ${label(n).toLowerCase()}?`, 'It stops receiving messages right away and its keys stop working for new messages.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => {
      try { await removeLinkedDevice(n); toast('Device removed.'); load(); }
      catch { toast('Couldn’t reach the server. Nothing changed.'); }
    } },
  ]);
  const onPhone = !isLinkedDevice();
  return (
    <Screen back title="Linked devices">
      {failed && <T variant="muted">Couldn’t reach the server. Check your connection.</T>}
      {info && <ListBox>
        {info.devices.map((d, i) => (
          <Row key={d.device} first={i === 0}>
            <Icon name={d.device === 1 ? 'mobile' : 'tablet'} color={c.ink} />
            <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>{label(d.device)}</T><T variant="muted">Added {new Date(d.created).toLocaleDateString()}</T></View>
            {d.device === info.me ? <Chip label="This device" tone="pine" /> : onPhone && d.device !== 1 ? <Button kind="danger" label="Remove" onPress={() => remove(d.device)} /> : null}
          </Row>
        ))}
      </ListBox>}
      {onPhone && info && info.devices.length < info.limit && <>
        <T variant="muted">On the other device, install It’s a Lifestyle and tap “Link to my account on another phone.” Then scan the code it shows.</T>
        <Button kind="primary" icon="plus" label="Scan a device’s code" onPress={() => router.push('/scan')} />
      </>}
      {onPhone && info && info.devices.length >= info.limit && <T variant="muted">You’ve linked the most devices allowed. Remove one to add another.</T>}
      {!onPhone && <T variant="muted">Devices are added and removed from your phone.</T>}
      <T variant="muted">Linked devices get new messages from the time they’re linked. Earlier chats stay where they are.</T>
    </Screen>
  );
}

function Receive() {
  const [prep] = useState(() => prepareLinkIn());
  // Simulators can't scan with the camera; development builds log the code so it can be opened as a link.
  useEffect(() => { if (__DEV__) console.log('[link] code', prep.qr); }, [prep]);
  const [step, setStep] = useState('Waiting for your phone to scan this code…');
  const [error, setError] = useState('');
  const cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    prep.wait(setStep, () => cancelled.current)
      .then(ok => { if (ok) { router.dismissAll(); toast('This device is linked. New messages will show up here.'); } })
      .catch(e => setError(e instanceof Error && !/relay/.test(e.message) ? e.message : 'Something went wrong. Try again.'));
    return () => { cancelled.current = true; };
  }, [prep]);
  return (
    <Screen back title="Link this device">
      <T variant="muted">On your phone, open It’s a Lifestyle, go to Me → Linked devices, and scan this code.</T>
      <View style={{ alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF', borderRadius: 18 }} accessible accessibilityRole="image" accessibilityLabel="Link code for your phone to scan">
        <QRCode value={prep.qr} size={240} color="#1D2C25" backgroundColor="#FFFFFF" ecl="M" />
      </View>
      {error ? <Notice icon="shield" title="That didn’t work">{error}</Notice> : <T variant="strong">{step}</T>}
      <Notice icon="lock" title="Keep this private">Anyone who scans this code with your phone gets access to your account on this device. Only scan it yourself.</Notice>
    </Screen>
  );
}

function Approve({ code }: { code: string }) {
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState(false);
  const go = () => Alert.alert('Link this device?', 'It will be able to read and send your messages from now on. Only continue if it’s your device and you’re holding it.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Link', onPress: async () => {
      setBusy(true);
      try {
        if (await linkDevice(code, setStep)) { router.replace('/devices'); toast('Device linked.'); }
        else { setBusy(false); setStep('The other device didn’t finish in time. Try again.'); }
      } catch (e) { if (__DEV__) console.log('[link] failed', String(e), e instanceof RelayError ? JSON.stringify(e.body) : ''); setBusy(false); setStep(e instanceof Error && !/relay/.test(e.message) ? e.message : 'Couldn’t reach the server. Nothing changed.'); }
    } },
  ]);
  return (
    <Screen back={!busy} title="Link a device">
      <Notice icon="shield" title="Only link your own device">If someone asked you to scan this code, stop. Linking lets that device read and send messages as you.</Notice>
      {!!step && <T variant="strong">{step}</T>}
      {!busy && <Button kind="primary" label="Link this device" onPress={go} />}
      {!busy && <Button label="Cancel" onPress={() => router.back()} />}
    </Screen>
  );
}
