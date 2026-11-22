import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlanCard } from '@/components/cards';
import { IconButton, Screen, Section, T } from '@/components/ui';
import { actions, byDate, spanDays, useStore } from '@/data/store';
import type { Calendar, Plan } from '@/data/types';
import { fonts, toneColors } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';
import { monthWeeks, WEEKDAYS, WEEKDAY_NAMES } from '@/components/monthGrid';

const toISOday = (y: number, m: number, d: number) => `${y}-${m}-${d}`;
const calOf = (p: Plan, cals: Calendar[]) => (p.audience.startsWith('cal:') ? p.audience.slice(4) : cals[0]?.name);

export default function CalendarScreen() {
  const { c } = useTheme();
  const plans = useStore(s => s.plans);
  const cals = useStore(s => s.cals);
  const [view, setView] = useState(() => { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1 }; });
  const month = view.m;
  const shift = (n: number) => { setView(v => { const d = new Date(v.y, v.m - 1 + n, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }); setSel(null); };
  const [sel, setSel] = useState<number | null>(null);

  const calFor = (p: Plan) => cals.find(x => x.name === calOf(p, cals)) ?? cals[0];
  const visible = plans.filter(p => !p.live && p.type !== 'poll' && p.m && calFor(p)?.on);
  const first = new Date(view.y, month - 1, 1);
  const mName = first.toLocaleDateString('en-US', { month: 'long' });

  const byDay: Record<number, Plan[]> = {};
  visible.forEach(p => {
    // Challenges run for weeks; mark only their first day so the calendar stays readable.
    const span = p.challenge ? 1 : spanDays(p);
    for (let i = 0; i < span; i++) {
      const dt = new Date(p.y ?? 2026, p.m - 1, p.d + i);
      if (dt.getMonth() + 1 === month && dt.getFullYear() === view.y) (byDay[dt.getDate()] ??= []).push(p);
    }
  });
  const inMonth = visible.filter(p => Object.values(byDay).some(l => l.includes(p))).sort(byDate);
  const list = sel ? byDay[sel] ?? [] : inMonth;
  const onCount = cals.filter(x => x.on).length;

  return (
    <Screen title="Calendar" right={<IconButton name="users" label="Who’s on each calendar" onPress={() => router.push('/calendars')} />}>
      <View style={{ gap: 8 }}>
        <View style={styles.chips}>
          {cals.map((cal, i) => {
            const [fg] = toneColors(c, cal.tone);
            return (
              <Pressable key={cal.name} onPress={() => { actions.toggleCalendar(i); toast(cal.on ? `Hiding ${cal.name}` : `Showing ${cal.name}`); }} accessibilityRole="switch" accessibilityState={{ checked: cal.on }}
                style={[styles.calchip, { backgroundColor: c.card, borderColor: c.line, borderStyle: cal.on ? 'solid' : 'dashed' }]}>
                <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: fg, backgroundColor: cal.on ? fg : 'transparent' }} />
                <Text style={{ fontFamily: fonts.bodySemi, color: cal.on ? c.ink : c.muted }}>{cal.name}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: c.muted }}>{cal.on ? cal.n : 'Hidden'}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => router.push('/calendars?new=1')} accessibilityRole="button"
            style={[styles.calchip, { backgroundColor: c.card, borderColor: c.line }]}>
            <Text style={{ fontFamily: fonts.bodySemi, color: c.ink }}>+ New calendar</Text>
          </Pressable>
        </View>
        <T variant="muted">Showing {onCount} of {cals.length} calendars. Tap one to show or hide it.</T>
      </View>

      <View style={[styles.month, { backgroundColor: c.card, borderColor: c.line }]}>
        <View style={styles.mh}>
          <IconButton name="back" label="Previous month" onPress={() => shift(-1)} />
          <Text style={{ fontFamily: fonts.display, fontSize: 17, color: c.ink }}>{mName} {view.y}</Text>
          <View style={{ transform: [{ scaleX: -1 }] }}><IconButton name="back" label="Next month" onPress={() => shift(1)} /></View>
        </View>
        <View style={styles.row}>
          {WEEKDAYS.map((d, i) => <Text key={d} accessibilityLabel={WEEKDAY_NAMES[i]} style={[styles.cell, styles.dow, { color: c.muted }]}>{d}</Text>)}
        </View>
        {monthWeeks(view.y, month - 1).map((week, w) => <View key={w} style={styles.row}>{week.map((d, k) => {
            if (!d) return <View key={k} style={styles.cell} />;
            const ev = byDay[d] ?? [], on = sel === d, today = toISOday(view.y, month, d) === toISOday(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate());
            return (
              <Pressable key={k} onPress={() => setSel(on ? null : d)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${mName} ${d}${today ? ', today' : ''}${ev.length ? `, ${ev.length} ${ev.length === 1 ? 'plan' : 'plans'}` : ''}`}
                style={[styles.cell, { borderRadius: 11, backgroundColor: on ? c.pine : 'transparent' }]}>
                <Text style={{ fontFamily: today ? fonts.bodyBold : fonts.body, fontSize: 14, color: on ? c.onPine : today ? c.pine : c.ink }}>{d}</Text>
                <View style={styles.dots}>{ev.slice(0, 3).map((p, k) => <View key={k} style={[styles.dot, { backgroundColor: on ? c.onPine : toneColors(c, calFor(p).tone)[0] }]} />)}</View>
              </Pressable>
            );
          })}</View>)}
      </View>

      <Section title={sel ? `${mName} ${sel}` : `All of ${mName}`}>
        {list.length ? list.map(p => <PlanCard key={p.id} p={p} />)
          : <T variant="muted">{onCount ? `Nothing in ${mName} on the calendars you’re showing.` : 'All your calendars are hidden. Tap one above to show it.'}</T>}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  calchip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1 },
  month: { borderWidth: 1, borderRadius: 18, padding: 12 },
  mh: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  row: { flexDirection: 'row' },
  cell: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' },
  dow: { height: 24, fontFamily: fonts.bodyBold, fontSize: 11, textAlign: 'center', textAlignVertical: 'center' },
  dots: { position: 'absolute', bottom: 4, flexDirection: 'row', gap: 2 },
  dot: { width: 4, height: 4, borderRadius: 2 },
});

