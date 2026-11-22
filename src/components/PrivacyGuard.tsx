import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Button } from './ui';
import { toast } from './Toast';
import { LakeLogo } from './LakeLogo';
import { useStore } from '@/data/store';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// App lock and app-switcher privacy.
//  - "Hide chats in app switcher": covers the app whenever it isn't in the foreground.
//  - "App lock": after the app has been in the background, Face ID or fingerprint is needed to open it.
let lockNowListener: (() => void) | null = null;
export const lockNow = () => lockNowListener?.();

export function PrivacyGuard() {
  const { c } = useTheme();
  const sec = useStore(s => s.me.sec);
  const [covered, setCovered] = useState(false);
  const [locked, setLocked] = useState(false);
  const wentToBackground = useRef(false);

  const unlock = useCallback(async () => {
    // A phone with no passcode at all can't protect the app; say so instead of pretending.
    // Otherwise only a successful Face ID, fingerprint or phone passcode unlocks. Cancelling never does.
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) {
      setLocked(false);
      toast('Set a passcode on this phone for app lock to work.');
      return;
    }
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock It’s a Lifestyle', fallbackLabel: 'Use passcode' });
    if (r.success) setLocked(false);
  }, []);

  useEffect(() => {
    lockNowListener = () => setLocked(true);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'background') wentToBackground.current = true;
      setCovered(state !== 'active' && sec.blur);
      if (state === 'active' && wentToBackground.current) {
        wentToBackground.current = false;
        if (sec.lock) setLocked(true);
      }
    });
    return () => { sub.remove(); lockNowListener = null; };
  }, [sec.blur, sec.lock]);

  if (locked) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.surface }]} accessibilityViewIsModal>
        <LakeLogo height={84} />
        <Text style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: c.muted }}>Locked</Text>
        <Button kind="primary" icon="lock" label="Unlock with Face ID or fingerprint" onPress={unlock} style={{ alignSelf: 'stretch', marginHorizontal: 32 }} />
      </View>
    );
  }
  if (covered) return <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.surface }]}><LakeLogo height={84} /></View>;
  return null;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 18, zIndex: 100 },
});
