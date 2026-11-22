import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EMOJI_CATS } from '@/data/emoji';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Recently used emoji, shared by every chat for this session.
const recent: string[] = [];

export function EmojiPicker({ onPick, heading, onCancel }: { onPick: (e: string) => void; heading?: string; onCancel?: () => void }) {
  const { c } = useTheme();
  const tabs = (recent.length ? [{ name: 'Recent', icon: '🕘', list: recent }] : []).concat(EMOJI_CATS);
  const [cur, setCur] = useState(0);
  const cat = tabs[Math.min(cur, tabs.length - 1)];
  const pick = (e: string) => { recent.splice(0, recent.length, ...[e, ...recent.filter(x => x !== e)].slice(0, 24)); onPick(e); };
  return (
    <View style={[styles.panel, { backgroundColor: c.card, borderTopColor: c.line }]}>
      {!!heading && (
        <View style={styles.head}>
          <Text style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: c.muted }}>{heading}</Text>
          {onCancel && <Pressable onPress={onCancel} accessibilityRole="button"><Text style={{ fontFamily: fonts.bodySemi, color: c.pine }}>Cancel</Text></Pressable>}
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomWidth: 1, borderBottomColor: c.line }} contentContainerStyle={styles.tabs}>
        {tabs.map((t, i) => (
          <Pressable key={t.name} onPress={() => setCur(i)} accessibilityRole="tab" accessibilityLabel={t.name} accessibilityState={{ selected: i === cur }}
            style={[styles.tab, i === cur && { backgroundColor: c.surface }]}>
            <Text style={{ fontSize: 18, opacity: i === cur ? 1 : 0.55 }}>{t.icon}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={{ maxHeight: 216 }} contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
        {cat.list.map(e => (
          <Pressable key={e} onPress={() => pick(e)} accessibilityRole="button" accessibilityLabel={`Insert ${e}`} style={styles.cell}>
            <Text style={{ fontSize: 24 }}>{e}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderTopWidth: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 8 },
  tabs: { paddingHorizontal: 8, paddingVertical: 6, gap: 2 },
  tab: { width: 40, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingVertical: 6 },
  cell: { width: '12.5%', height: 42, alignItems: 'center', justifyContent: 'center' },
});
