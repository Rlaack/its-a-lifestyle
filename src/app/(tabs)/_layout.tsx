import { Tabs, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Icon } from '@/components/Icon';
import { JoinScreen } from '@/components/JoinScreen';
import { useStore } from '@/data/store';
import type { IconName } from '@/theme/paths';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { useGutter } from '@/components/ui';

const TABS: { name: string; label: string; icon: IconName }[] = [
  { name: 'index', label: 'Home', icon: 'home' },
  { name: 'calendar', label: 'Calendar', icon: 'cal' },
  { name: 'chats', label: 'Chats', icon: 'chat' },
  { name: 'me', label: 'Me', icon: 'user' },
];

function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const gutter = useGutter(6);
  const current = state.routes[state.index]?.name;
  const tab = (t: (typeof TABS)[number]) => {
    const on = current === t.name;
    return (
      <Pressable key={t.name} onPress={() => { const r = state.routes.find(x => x.name === t.name); if (r) navigateToTab(r.key); }} style={styles.tab}
        accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}>
        <View style={[styles.pill, on && { backgroundColor: c.pineSoft }]}>
          <Icon name={t.icon} color={on ? c.pine : c.muted} />
        </View>
        <Text style={[styles.label, { color: on ? c.pine : c.muted }]}>{t.label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.bar, { paddingHorizontal: gutter, backgroundColor: c.card, borderTopColor: c.line, paddingBottom: Math.max(insets.bottom, 10) }]}>
      {tab(TABS[0])}{tab(TABS[1])}
      <Pressable onPress={() => router.push('/create')} accessibilityRole="button" accessibilityLabel="Plan something" style={styles.makeWrap}>
        <View style={[styles.make, { backgroundColor: c.pine }]}><Icon name="plus" color={c.onPine} size={26} /></View>
      </Pressable>
      {tab(TABS[2])}{tab(TABS[3])}
    </View>
  );
}

export default function TabsLayout() {
  const joined = useStore(s => s.hood.joined);
  if (!joined) return <JoinScreen />;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={props => <TabBar {...props} />}>
      {TABS.map(t => <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />)}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingHorizontal: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  pill: { paddingHorizontal: 14, paddingVertical: 3, borderRadius: 12 },
  label: { fontFamily: fonts.bodySemi, fontSize: 10.5 },
  makeWrap: { width: 64, alignItems: 'center' },
  make: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: -4 },
});
