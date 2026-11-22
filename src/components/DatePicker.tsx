import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconButton } from './ui';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { monthWeeks, WEEKDAYS, WEEKDAY_NAMES } from './monthGrid';

// A month calendar in the app's own style. Three modes:
//  single — one date (most plans)
//  range  — start and end (meal trains)
//  multi  — several dates (date polls)
// Dates are plain local dates as 'YYYY-MM-DD' strings so nothing shifts across time zones.

export type ISODate = string;
export const toISO = (d: Date): ISODate =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromISO = (s: ISODate) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const prettyDate = (s: ISODate, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) =>
  fromISO(s).toLocaleDateString('en-US', opts);

type Bounds = { min: ISODate; max?: ISODate };
type Props = Bounds & (
  | { mode: 'single'; value: ISODate | null; onChange: (v: ISODate) => void }
  | { mode: 'range'; value: [ISODate | null, ISODate | null]; onChange: (v: [ISODate | null, ISODate | null]) => void }
  | { mode: 'multi'; value: ISODate[]; onChange: (v: ISODate[]) => void });

export function DatePicker(props: Props) {
  const { c } = useTheme();
  const start = props.mode === 'single' ? props.value : props.mode === 'range' ? props.value[0] : props.value[0];
  const [view, setView] = useState(() => { const d = fromISO(start ?? props.min); return { y: d.getFullYear(), m: d.getMonth() }; });
  const minD = fromISO(props.min);
  const first = new Date(view.y, view.m, 1);
  const canPrev = view.y > minD.getFullYear() || (view.y === minD.getFullYear() && view.m > minD.getMonth());
  const maxD = props.max ? fromISO(props.max) : null;
  const canNext = !maxD || view.y < maxD.getFullYear() || (view.y === maxD.getFullYear() && view.m < maxD.getMonth());
  const todayISO = toISO(new Date());
  const shift = (n: number) => setView(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });

  const state = (iso: ISODate): 'none' | 'on' | 'edge' | 'between' => {
    if (props.mode === 'single') return props.value === iso ? 'on' : 'none';
    if (props.mode === 'multi') return props.value.includes(iso) ? 'on' : 'none';
    const [a, b] = props.value;
    if (iso === a || iso === b) return 'edge';
    if (a && b && iso > a && iso < b) return 'between';
    return 'none';
  };

  const pick = (iso: ISODate) => {
    if (props.mode === 'single') props.onChange(iso);
    else if (props.mode === 'multi') props.onChange(props.value.includes(iso) ? props.value.filter(x => x !== iso) : [...props.value, iso].sort());
    else {
      const [a, b] = props.value;
      if (!a || b) props.onChange([iso, null]);          // start a new range
      else if (iso < a) props.onChange([iso, null]);      // earlier than start: restart there
      else props.onChange([a, iso]);                      // complete the range
    }
  };

  return (
    <View style={[styles.box, { backgroundColor: c.card, borderColor: c.line }]}>
      <View style={styles.head}>
        <View style={{ opacity: canPrev ? 1 : 0.3 }} pointerEvents={canPrev ? 'auto' : 'none'}>
          <IconButton name="back" label="Previous month" onPress={() => shift(-1)} />
        </View>
        <Text style={{ fontFamily: fonts.display, fontSize: 17, color: c.ink }}>
          {first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </Text>
        <View style={{ transform: [{ scaleX: -1 }], opacity: canNext ? 1 : 0.3 }} pointerEvents={canNext ? 'auto' : 'none'}><IconButton name="back" label="Next month" onPress={() => shift(1)} /></View>
      </View>
      <View style={styles.row}>
        {WEEKDAYS.map((d, i) => <Text key={d} accessibilityLabel={WEEKDAY_NAMES[i]} style={[styles.cell, styles.dow, { color: c.muted }]}>{d}</Text>)}
      </View>
      {monthWeeks(view.y, view.m).map((week, w) => (
        <View key={w} style={styles.row}>
          {week.map((day, k) => {
            if (!day) return <View key={k} style={styles.cell} />;
            const iso = toISO(new Date(view.y, view.m, day));
            const off = iso < props.min || (!!props.max && iso > props.max);
            const st = state(iso);
            const strong = st === 'on' || st === 'edge';
            const isToday = iso === todayISO;
            return (
              <View key={k} style={[styles.cell, st === 'between' && { backgroundColor: c.pineSoft }]}>
                <Pressable disabled={off} onPress={() => pick(iso)} accessibilityRole="button"
                  accessibilityLabel={`${prettyDate(iso, { weekday: 'long', month: 'long', day: 'numeric' })}${isToday ? ', today' : ''}`} accessibilityState={{ selected: strong, disabled: off }}
                  style={[styles.day, strong && { backgroundColor: c.pine }, !strong && isToday && { borderWidth: 1.5, borderColor: c.pine }]}>
                  <Text style={{ fontFamily: strong || isToday ? fonts.bodyBold : fonts.body, fontSize: 15, color: strong ? c.onPine : off ? c.line : isToday ? c.pine : c.ink }}>{day}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 18, padding: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  row: { flexDirection: 'row' },
  cell: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' },
  dow: { height: 24, fontFamily: fonts.bodyBold, fontSize: 11, textAlign: 'center' },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
