import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Avatar, Button, IconButton, ListBox, Row, Screen, T } from '@/components/ui';
import { toast } from '@/components/Toast';
import { blockedPeople, setBlocked, useSecureVersion } from '@/data/secure/sync';

// Everyone you've blocked. Their messages are hidden and they can't message you; unblock anyone here.
export default function BlockedScreen() {
  useSecureVersion(); // re-render after an unblock
  const people = blockedPeople();
  const unblock = (account: string, name: string) => Alert.alert(`Unblock ${name}?`, 'Their messages show again, and they can message you directly.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unblock', onPress: () => { setBlocked(account, false, name); toast(`Unblocked ${name}.`); } },
  ]);
  return (
    <Screen sheet title="Blocked people" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <T variant="muted">People you block can’t message you, and their messages in group and plan chats are hidden from you. They aren’t told.</T>
      {people.length ? (
        <ListBox>
          {people.map((p, i) => (
            <Row key={p.account} first={i === 0}>
              <Avatar name={p.name} size={36} ring={false} />
              <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>{p.name}</T></View>
              <Button label="Unblock" onPress={() => unblock(p.account, p.name)} />
            </Row>
          ))}
        </ListBox>
      ) : <T variant="muted">You haven’t blocked anyone. To block someone, long-press one of their messages and choose Report or block.</T>}
    </Screen>
  );
}
