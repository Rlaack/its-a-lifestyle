import { PausedScreen, useHoodPaused } from '@/components/PlanNotice';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/Icon';
import { IconButton, ListBox, Row, Screen, Section, T } from '@/components/ui';
import { isPast, lastDayOf, useStore } from '@/data/store';
import { PLAN_TYPES } from '@/data/planTypes';
import type { PlanType } from '@/data/types';
import { toneColors } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

function CreateMenu() {
  const { c } = useTheme();
  const past = useStore(s => s.plans.filter(isPast)).slice().sort((a, b) => lastDayOf(b).localeCompare(lastDayOf(a)));
  return (
    <Screen sheet title="What’s the plan?" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <View style={styles.grid}>
        {(Object.keys(PLAN_TYPES) as PlanType[]).map(k => {
          const t = PLAN_TYPES[k];
          const [fg, bg] = toneColors(c, t.tone);
          return (
            <Pressable key={k} onPress={() => router.replace(`/create/${k}`)} accessibilityRole="button"
              style={({ pressed }) => [styles.tile, { backgroundColor: c.card, borderColor: c.line, opacity: pressed ? 0.85 : 1 }]}>
              <View style={[styles.ic, { backgroundColor: bg }]}><Icon name={t.icon} color={fg} /></View>
              <T variant="strong" style={{ fontSize: 15 }}>{t.label}</T>
              <T variant="muted">{t.blurb}</T>
            </Pressable>
          );
        })}
      </View>
      {past.length > 0 && (
        <Section title="Start from a past plan">
          <T variant="muted">Plans from the last 3 months. Copy one, pick new dates and change anything else.</T>
          <ListBox>
            {past.map((p, i) => {
              const t = PLAN_TYPES[p.type];
              const [fg] = toneColors(c, t.tone);
              return (
                <Row key={p.id} first={i === 0} onPress={() => router.replace(`/create/${p.type}?from=${p.id}`)}>
                  <Icon name={t.icon} color={fg} />
                  <View style={{ flex: 1 }}>
                    <T variant="strong" style={{ fontSize: 15 }}>{p.title}</T>
                    <T variant="muted">{t.label} · {new Date(`${lastDayOf(p)}T12:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</T>
                  </View>
                  <T variant="strong" style={{ color: c.pine }}>Copy</T>
                </Row>
              );
            })}
          </ListBox>
        </Section>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, borderWidth: 1, borderRadius: 16, padding: 12, gap: 6 },
  ic: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});

export default function GuardedCreateMenu() {
  return useHoodPaused() ? <PausedScreen /> : <CreateMenu />;
}
