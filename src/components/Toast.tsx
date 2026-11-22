import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Short confirmations after an action ("You’re going. We’ll remind you the day before.").
// Call toast() from anywhere; <Toaster /> lives once in the root layout.
let show: ((m: string) => void) | null = null;
export function toast(message: string) {
  show?.(message);
  AccessibilityInfo.announceForAccessibility(message);
}

export function Toaster() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    show = m => { setMsg(m); clearTimeout(timer); timer = setTimeout(() => setMsg(null), 2600); };
    return () => { show = null; clearTimeout(timer); };
  }, []);
  if (!msg) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 96 }]}>
      <View style={[styles.pill, { backgroundColor: c.ink }]}>
        <Text style={[styles.text, { color: c.surface }]}>{msg}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  pill: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 14, maxWidth: 420 },
  text: { fontFamily: fonts.bodySemi, fontSize: 13.5, textAlign: 'center' },
});
