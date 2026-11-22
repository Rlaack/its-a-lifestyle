import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { toast } from '@/components/Toast';
import { Button, IconButton, Notice, Screen, T } from '@/components/ui';
import { connectWithCode, useSecureStatus } from '@/data/secure/sync';

// Opened from someone's invite link (itsalifestyle://connect?code=…). Never connects on its own:
// you see who it claims to be and decide.
export default function Connect() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const status = useSecureStatus();
  const [busy, setBusy] = useState(false);
  let name = '';
  try { name = decodeURIComponent((code ?? '').split(':').pop() ?? '').slice(0, 40); } catch { /* shown as unknown */ }
  const connect = async () => {
    if (!code) return;
    setBusy(true);
    const r = await connectWithCode(code, false);
    setBusy(false);
    if (!r.ok) return toast(r.reason);
    router.replace(`/chat/${r.chatId}`);
    toast(`Connected with ${r.name}.`);
  };
  return (
    <Screen sheet title="Invite link" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <T variant="heading">{name ? `Connect with ${name}?` : 'This link looks damaged'}</T>
      <T variant="muted">Only connect if you know who sent you this link. You’ll get an encrypted chat with them. Scan their code next time you meet to verify in person.</T>
      {status !== 'ready'
        ? <Notice icon="shield" title="Not ready">{status === 'unavailable' ? 'Encrypted chat needs the full app build.' : 'Still connecting. Try again in a moment.'}</Notice>
        : <Button kind="primary" label={busy ? 'Connecting…' : 'Connect'} onPress={busy || !name ? () => {} : connect} />}
      <Button label="Not now" onPress={() => router.back()} />
    </Screen>
  );
}
