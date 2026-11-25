import type { ReactNode } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Icon } from './Icon';
import { TopoBackground } from './TopoBackground';
import type { IconName } from '@/theme/paths';
import { fonts, radius, toneColors, type Tone } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { useStore } from '@/data/store';

/* ---------- text ---------- */
export function T({ children, style, variant = 'body', numberOfLines }: {
  children: ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number;
  variant?: 'body' | 'muted' | 'title' | 'heading' | 'label' | 'small' | 'strong';
}) {
  const { c } = useTheme();
  const v: Record<string, TextStyle> = {
    body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: c.ink },
    strong: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 21, color: c.ink },
    muted: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: c.muted },
    small: { fontFamily: fonts.bodySemi, fontSize: 12, color: c.muted },
    title: { fontFamily: fonts.logo, fontSize: 26, lineHeight: 30, color: c.ink },
    heading: { fontFamily: fonts.display, fontSize: 19, lineHeight: 23, color: c.ink },
    label: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: c.muted },
  };
  // Titles and section labels are headings, so VoiceOver users can jump between them.
  const heading = variant === 'title' || variant === 'heading' || variant === 'label';
  return <Text style={[v[variant], style]} numberOfLines={numberOfLines} accessibilityRole={heading ? 'header' : undefined}>{children}</Text>;
}

/* ---------- screen frame ---------- */
/** Widest a column of content gets (iPad, landscape): beyond it, the side margins grow instead. */
export const READ_WIDTH = 720;
/** Side padding that keeps content in a centered READ_WIDTH column on wide screens. */
export function useGutter(min = 18) {
  const { width } = useWindowDimensions();
  return Math.max(min, (width - READ_WIDTH) / 2);
}

export function Screen({ title, back, right, children, header, sheet }: {
  title?: string; back?: boolean; right?: ReactNode; children: ReactNode; header?: ReactNode;
  /** Shown as an iOS page sheet, which already sits below the status bar. */
  sheet?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const gutter = useGutter();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <TopoBackground />
      <View style={[styles.hdr, { paddingHorizontal: gutter, paddingTop: sheet && Platform.OS === 'ios' ? 16 : insets.top + 10, backgroundColor: c.surface, borderBottomColor: c.line }]}>
        {back && <IconButton name="back" label="Back" onPress={() => router.back()} />}
        {header ?? (title ? <T variant="title" style={{ flex: 1 }} numberOfLines={1}>{title}</T> : <View style={{ flex: 1 }} />)}
        {right}
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: gutter, paddingBottom: Math.max(insets.bottom, 16) + 48 }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">{children}</ScrollView>
    </View>
  );
}

export function Section({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      {(title || right) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          {title ? <T variant="label">{title}</T> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

/* ---------- controls ---------- */
export function IconButton({ name, label, onPress, active }: { name: IconName; label: string; onPress: () => void; active?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, { backgroundColor: active ? c.pineSoft : c.card, borderColor: active ? c.pine : c.line, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={name} color={active ? c.pine : c.ink} />
    </Pressable>
  );
}

export function Button({ label, onPress, kind = 'default', icon, style, grow }: {
  label: string; onPress: () => void; kind?: 'default' | 'primary' | 'ember' | 'on' | 'danger'; icon?: IconName; style?: StyleProp<ViewStyle>; grow?: boolean;
}) {
  const { c } = useTheme();
  const k = {
    default: { bg: c.card, fg: c.ink, bd: c.line },
    primary: { bg: c.pine, fg: c.onPine, bd: c.pine },
    ember: { bg: c.ember, fg: c.onPine, bd: c.ember },
    on: { bg: c.pineSoft, fg: c.pine, bd: c.pine },
    danger: { bg: c.card, fg: c.ember, bd: c.ember },
  }[kind];
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [styles.btn, { backgroundColor: k.bg, borderColor: k.bd, opacity: pressed ? 0.8 : 1 }, grow && { flex: 1 }, style]}>
      {icon && <Icon name={icon} color={k.fg} size={18} />}
      <Text style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: k.fg }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, tone = 'pine', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const { c } = useTheme();
  const [fg, bg] = toneColors(c, tone);
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {icon && <Icon name={icon} color={fg} size={14} />}
      <Text style={{ fontFamily: fonts.bodySemi, fontSize: 12, color: fg }}>{label}</Text>
    </View>
  );
}

export function Pick({ label, on, onPress, no }: { label: string; on?: boolean; onPress: () => void; no?: boolean }) {
  const { c } = useTheme();
  const fg = on ? (no ? c.plum : c.pine) : c.muted;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={[styles.pick, { borderColor: on ? fg : c.line, backgroundColor: on ? (no ? c.plumSoft : c.pineSoft) : c.card }]}>
      <Text style={{ fontFamily: fonts.bodySemi, fontSize: 13.5, color: fg, textDecorationLine: on && no ? 'line-through' : 'none' }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange, small }: {
  options: [T, string][]; value: T; onChange: (v: T) => void; small?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: c.card, borderColor: c.line }]}>
      {options.map(([k, l]) => (
        <Pressable key={k} onPress={() => onChange(k)} accessibilityRole="button" accessibilityState={{ selected: value === k }}
          style={[styles.segBtn, { height: small ? 30 : 36, backgroundColor: value === k ? c.pine : 'transparent' }]}>
          <Text style={{ fontFamily: fonts.bodySemi, fontSize: small ? 12.5 : 14, color: value === k ? c.onPine : c.muted }} numberOfLines={1}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ---------- surfaces ---------- */
export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const s = [styles.card, { backgroundColor: c.card, borderColor: c.line }, style];
  return onPress
    ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityHint="Double-tap for details" style={({ pressed }) => [s, { opacity: pressed ? 0.85 : 1 }]}>{children}</Pressable>
    : <View style={s}>{children}</View>;
}

export function ListBox({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <View style={[styles.list, { backgroundColor: c.card, borderColor: c.line }]}>{children}</View>;
}

export function Row({ children, onPress, first }: { children: ReactNode; onPress?: () => void; first?: boolean }) {
  const { c } = useTheme();
  const s = [styles.row, { borderTopColor: c.line, borderTopWidth: first ? 0 : 1 }];
  return onPress ? <Pressable onPress={onPress} style={s} accessibilityRole="button">{children}</Pressable> : <View style={s}>{children}</View>;
}

export function Notice({ icon = 'lock', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: c.card, borderColor: c.line }]}>
      <Icon name={icon} color={c.pine} size={18} />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="strong" style={{ fontSize: 14 }}>{title}</T>
        {children ? <T variant="muted">{children}</T> : null}
      </View>
    </View>
  );
}

/* ---------- people ---------- */
const AV_TONES: Tone[] = ['pine', 'ember', 'plum', 'sky'];
export const toneFor = (n: string): Tone => AV_TONES[[...n].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 4];
export const initials = (n: string) => n === 'You' ? 'ME' : n.replace(/^The /, '').split(/[\s&]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

export function Avatar({ name, size = 26, ring = true }: { name: string; size?: number; ring?: boolean }) {
  const { c } = useTheme();
  const pic = useStore(s => s.pics[name]);
  const [fg, bg] = toneColors(c, pic?.tone ?? toneFor(name));
  const box = { width: size, height: size, borderRadius: size / 2, borderWidth: ring ? 2 : 0, borderColor: c.card };
  if (pic?.uri) return <Image source={{ uri: pic.uri }} accessibilityLabel={name} style={[box, { backgroundColor: bg }]} />;
  return (
    <View accessibilityLabel={name} style={[box, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
      {pic?.emoji
        ? <Text style={{ fontSize: size * 0.52, lineHeight: size * 0.66 }}>{pic.emoji}</Text>
        : <Text style={{ fontFamily: fonts.bodyBold, fontSize: size * 0.36, color: fg }}>{initials(name)}</Text>}
    </View>
  );
}

export function AvatarStack({ names, max = 5 }: { names: string[]; max?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {names.slice(0, max).map((n, i) => <View key={n} style={{ marginLeft: i ? -7 : 0 }}><Avatar name={n} /></View>)}
    </View>
  );
}

const styles = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { padding: 18, paddingBottom: 40, gap: 22 },
  iconBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btn: { minHeight: 44, paddingHorizontal: 16, borderRadius: 13, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingLeft: 7, paddingRight: 9, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pick: { height: 36, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, padding: 4, gap: 4 },
  segBtn: { flex: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: 14, flexDirection: 'row', gap: 12 },
  list: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  notice: { flexDirection: 'row', gap: 10, padding: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, alignItems: 'flex-start' },
});
