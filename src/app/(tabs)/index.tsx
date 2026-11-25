import { localUri } from '@/data/secure/attachments';
import { Image, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { BeaconCard, LakeScene, NeedCard, PlanCard, PollCard, ChallengeCard } from '@/components/cards';
import { phaseOf } from '@/data/challenge';
import { LakeLogo } from '@/components/LakeLogo';
import { Icon } from '@/components/Icon';
import { NotificationBell } from '@/components/NotificationBell';
import { Screen, Section, T } from '@/components/ui';
import { byDate, isPast, openCount, useStore } from '@/data/store';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

export default function Home() {
  const { c } = useTheme();
  const plans = useStore(s => s.plans);
  const cur = useStore(s => s.cur);
  const hoodName = useStore(s => s.hood.name);
  const hoodMap = useStore(s => s.hood.map);
  const cover = useStore(s => s.hood.cover);
  const live = plans.filter(p => p.live);
  const needs = plans.filter(p => (p.days || p.type === 'help') && openCount(p) > 0).sort(byDate);
  const polls = plans.filter(p => p.type === 'poll');
  const challenges = plans.filter(p => p.challenge && phaseOf(p.challenge) !== 'over').sort(byDate);
  const upcoming = plans.filter(p => !p.live && p.type !== 'help' && p.type !== 'poll' && p.type !== 'challenge' && !isPast(p)).sort(byDate);
  // The owner's cover: a photo, the neighborhood drawing (only neighborhoods that have one), or nothing.
  const showDrawing = hoodMap === 'lake' && (!cover || cover.kind === 'drawing');

  return (
    <Screen right={<NotificationBell />} header={
      <Pressable style={{ flex: 1 }} onPress={() => router.push('/neighborhood')} accessibilityRole="button" accessibilityLabel={`${hoodName} neighborhood`}>
        {cur === 'lake' ? <LakeLogo height={52} /> : <Text style={{ fontFamily: fonts.logo, fontSize: 26, color: c.pine }}>{hoodName}</Text>}
      </Pressable>}>
      {cover?.kind === 'photo' && <Image source={{ uri: localUri(cover.uri) }} accessibilityLabel={`${hoodName} cover photo`} style={{ width: '100%', height: 170, borderRadius: 18 }} />}
      {showDrawing && <LakeScene fires={live.length} />}

      <Section title="Happening now">
        {live.map(p => <BeaconCard key={p.id} p={p} />)}
        <Pressable onPress={() => router.push('/create/beacon')} accessibilityRole="button"
          style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.ember + '88' }}>
          <Icon name="flame" color={c.ember} />
          <View style={{ flex: 1 }}>
            <T variant="strong" style={{ color: c.ember, fontSize: 15 }}>Light a beacon</T>
            <T variant="muted">Fire going? Hanging on the porch? Heading out for a walk? Let neighbors know.</T>
          </View>
        </Pressable>
      </Section>

      {needs.length > 0 && <Section title="Neighbors need a hand">{needs.map(p => <NeedCard key={p.id} p={p} />)}</Section>}
      {challenges.length > 0 && <Section title="Challenges">{challenges.map(p => <ChallengeCard key={p.id} p={p} />)}</Section>}
      {polls.length > 0 && <Section title="Polls">{polls.map(p => <PollCard key={p.id} p={p} />)}</Section>}

      <Section title="Coming up">
        {upcoming.length ? upcoming.map(p => <PlanCard key={p.id} p={p} />) : <T variant="muted">Nothing planned yet. Tap + to plan the first get-together.</T>}
      </Section>
    </Screen>
  );
}
