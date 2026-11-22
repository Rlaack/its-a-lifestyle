import { useEffect, useState } from 'react';
import Crypto from '../../../modules/lifestyle-crypto';
import type { Chat } from '@/data/types';
import { isBlocked, setBlocked, setChatDisappearing, supportId, useSecureVersion } from '@/data/secure/sync';
import { Pressable, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { toast } from '@/components/Toast';
import { IconButton, Notice, Screen, Section, Segmented, T } from '@/components/ui';
import { NOT_ENCRYPTED_WARNING, SENSITIVE_INFO_NOTICE } from '@/data/security';
import { useStore } from '@/data/store';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Chat details: encryption, verification, disappearing messages and blocking.
export default function ChatInfo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useStore(s => s.chats.find(c => c.id === id));
  if (!chat) return null;
  if (chat.secure) return <SecureInfo chat={chat} />;
  return (
    <Screen sheet title="Chat details" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      {chat.shared
        ? <Notice icon="lock" title="End-to-end encrypted">Only people in this chat can read it. Our server passes along scrambled data.</Notice>
        : <Notice icon="shield" title="Not encrypted">{NOT_ENCRYPTED_WARNING}</Notice>}
      <T variant="muted">{SENSITIVE_INFO_NOTICE}</T>
      <Disappearing chat={chat} />
    </Screen>
  );
}

/** Applies to everyone in the chat: the change travels inside the encryption. */
function Disappearing({ chat }: { chat: Chat }) {
  return (
    <Section title="Disappearing messages">
      <Segmented small options={[['Off', 'Off'], ['1 day', '1 day'], ['1 week', '1 week']]} value={chat.timer ?? 'Off'}
        onChange={v => {
          setChatDisappearing(chat, v).catch(() => toast('Couldn’t tell everyone in this chat. Check your connection and set it again.'));
          toast(v === 'Off' ? 'Messages in this chat stay' : `New messages disappear after ${v}`);
        }} />
      <T variant="muted">Applies to new messages from everyone in this chat, on their phones too. Someone can still screenshot or copy a message before it disappears.</T>
    </Section>
  );
}

// Details for an end-to-end encrypted chat (libsignal). Says plainly what is and isn't protected yet.
function SecureInfo({ chat }: { chat: Chat }) {
  const { c } = useTheme();
  const link = chat.secure!;
  useSecureVersion();
  const blocked = isBlocked(link.account);
  const [number, setNumber] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (!Crypto) return;
    Crypto.safetyNumber(link.account, 1).then(setNumber).catch(() => setNumber(null));
    Crypto.identityChanged(link.account, 1).then(setChanged).catch(() => {});
  }, [link.account]);
  const accept = async () => {
    await Crypto?.acceptIdentityChange(link.account, 1);
    setChanged(false);
    toast('New key accepted. Scan their code next time you meet to verify again.');
  };
  return (
    <Screen sheet title="Encryption" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <Notice icon="lock" title="End-to-end encrypted">Messages are encrypted on your phone with the Signal Protocol. Our implementation hasn’t been independently audited.</Notice>
      {link.verified
        ? <Notice icon="check" title={`You verified ${chat.name} in person`}>You scanned their code, so their phone’s key is pinned. If it ever changes, you’ll see a notice and the app won’t send until you accept it.</Notice>
        : <Notice icon="shield" title="Not verified">{link.unknown ? 'This person isn’t one of your connections.' : 'You haven’t scanned each other’s code yet.'} Meet in person and scan their code.</Notice>}
      {changed && <>
        <Notice icon="shield" title={`${chat.name}’s key changed`}>This usually means a new phone or a reinstall, but it could also mean someone is trying to listen in. Check with them in person before you accept.</Notice>
        <Pressable onPress={accept} accessibilityRole="button" style={{ padding: 12 }}><T variant="strong" style={{ textAlign: 'center' }}>Accept the new key</T></Pressable>
      </>}
      <Disappearing chat={chat} />
      <T variant="muted">{SENSITIVE_INFO_NOTICE}</T>
      <Pressable onPress={() => { setBlocked(link.account, !blocked, chat.name); toast(blocked ? `Unblocked ${chat.name}.` : `Blocked ${chat.name}. You won’t get their messages.`); }} accessibilityRole="button" style={{ padding: 12 }}>
        <T variant="strong" style={{ textAlign: 'center', color: c.ember }}>{blocked ? `Unblock ${chat.name}` : `Block ${chat.name}`}</T>
      </Pressable>
      <T variant="muted" style={{ textAlign: 'center' }}>{chat.name}’s support ID: {supportId(link.account)}. To report something serious to us, email it with a screenshot to admin@cyber-affinity.com.</T>
      {number && (
        <Section title="Safety number (advanced)">
          <T variant="muted">Matches on both phones only if no one is in the middle.</T>
          <Text selectable style={{ fontFamily: fonts.body, fontSize: 15, letterSpacing: 1, color: c.ink }}>{number.match(/.{1,5}/g)?.join(' ')}</Text>
        </Section>
      )}
    </Screen>
  );
}
