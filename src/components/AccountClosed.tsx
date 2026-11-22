import { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { LakeLogo } from './LakeLogo';
import { deleteMyAccount, useSecureStatus } from '@/data/secure/sync';
import { TERMS_URL } from '@/data/security';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';


/** Shown over everything when we've closed this account for breaking the community guidelines. */
export function AccountClosed() {
  const { c } = useTheme();
  const status = useSecureStatus();
  const [busy, setBusy] = useState(false);
  if (status !== 'closed') return null;
  const wipe = () => Alert.alert('Erase this phone’s data?', 'This deletes your keys, chats and plans from this phone. It can’t be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Erase', style: 'destructive', onPress: async () => { setBusy(true); try { await deleteMyAccount(); } finally { setBusy(false); } } },
  ]);
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.surface }]} accessibilityViewIsModal>
      <LakeLogo height={72} />
      <Text style={[styles.h1, { color: c.ink }]}>This account was closed</Text>
      <Text style={[styles.body, { color: c.muted }]}>It was closed for breaking the community guidelines. It has been removed from its neighborhoods and can’t send or receive messages.</Text>
      <Button label="Read the community guidelines" onPress={() => Linking.openURL(TERMS_URL)} style={styles.button} />
      <Button kind="danger" label={busy ? 'Erasing…' : 'Erase this phone’s data'} onPress={busy ? () => {} : wipe} style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, zIndex: 200 },
  h1: { fontFamily: fonts.bodyBold, fontSize: 22, textAlign: 'center' },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  button: { alignSelf: 'stretch' },
});
