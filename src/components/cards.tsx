import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { AvatarStack, Button, Card, Chip, T } from './ui';
import { Icon } from './Icon';
import { PLAN_TYPES, POST_REACTIONS } from '@/data/planTypes';
import { actions, openCount, slotsOf } from '@/data/store';
import { daysLeft, groupPoints, phaseOf, prettyISO, rulesText, standings } from '@/data/challenge';
import type { Plan } from '@/data/types';
import { fonts, toneColors } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';

const open = (p: Plan) => router.push(`/event/${p.id}`);

function DateBlock({ p }: { p: Plan }) {
  const { c } = useTheme();
  const [fg, bg] = toneColors(c, PLAN_TYPES[p.type].tone);
  return (
    <View style={[styles.date, { backgroundColor: bg }]}>
      {p.type === 'poll' || p.type === 'challenge' ? <Icon name={p.type === 'poll' ? 'poll' : 'trophy'} color={fg} /> : <>
        <Text style={[styles.dow, { color: fg }]}>{p.dow.toUpperCase()}</Text>
        <Text style={[styles.day, { color: fg }]}>{p.d}</Text>
        {!!p.end && <Text style={[styles.dow, { color: fg }]}>to {Number(p.end.slice(8))}</Text>}
      </>}
    </View>
  );
}

export const reactionSummary = (p: Plan) =>
  POST_REACTIONS.map(([e]) => [e, (p.r?.[e] ?? []).length] as const).filter(([, n]) => n).map(([e, n]) => `${e} ${n}`).join('  ');

export function PlanCard({ p }: { p: Plan }) {
  const { c } = useTheme();
  const T_ = PLAN_TYPES[p.type];
  const total = p.days ? slotsOf(p).length : p.lists ? p.lists.flatMap(l => l.items).length : 0;
  const done = total - openCount(p);
  const helpers = p.type === 'mealtrain' ? [...new Set(slotsOf(p).filter(s => s.by).map(s => s.by!))] : p.going;
  const summary = reactionSummary(p);
  return (
    <Card onPress={() => open(p)}>
      <DateBlock p={p} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Chip label={T_.label} icon={T_.icon} tone={T_.tone} />
          {p.audience === 'except' && <Chip label="Secret" icon="eyeoff" tone="plum" />}
        </View>
        <T variant="strong">{p.title}</T>
        {!!(p.where || p.mapAddress) && <View style={styles.meta}><Icon name="pin" size={15} color={c.muted} /><T variant="muted" numberOfLines={1}>{p.where || p.mapAddress}</T></View>}
        {total > 0 && (
          <View style={styles.meta}>
            <View style={[styles.bar, { backgroundColor: c.line }]}><View style={{ width: `${(done / total) * 100}%`, height: '100%', backgroundColor: toneColors(c, T_.tone)[0], borderRadius: 9 }} /></View>
            <T variant="muted">{done} of {total} {p.days ? 'meals covered' : 'claimed'}</T>
          </View>
        )}
        <View style={[styles.meta, { justifyContent: 'space-between' }]}>
          <AvatarStack names={helpers} />
          <T variant="muted">{helpers.length} {p.type === 'mealtrain' ? 'helping' : 'going'}{p.rsvp === 'going' ? ' · incl. you' : ''}</T>
        </View>
        {!!summary && <T variant="muted">{summary}</T>}
      </View>
    </Card>
  );
}

// A challenge on Home: rules, who's leading, how many joined, days left.
export function ChallengeCard({ p }: { p: Plan }) {
  const ch = p.challenge!;
  const board = standings(p);
  const me = board.find(r => r.who === 'You');
  const phase = phaseOf(ch);
  const top = board.filter(r => r.pts > 0).slice(0, 3);
  return (
    <Card onPress={() => open(p)}>
      <DateBlock p={p} />
      <View style={{ flex: 1, gap: 6 }}>
        <Chip label={phase === 'on' ? `Challenge · ${daysLeft(ch)} ${daysLeft(ch) === 1 ? 'day' : 'days'} left` : phase === 'upcoming' ? `Challenge · starts ${prettyISO(ch.start)}` : 'Challenge · final'} icon="trophy" tone="pine" />
        <T variant="strong">{p.title}</T>
        <T variant="muted" numberOfLines={1}>{rulesText(ch)}</T>
        {top.length > 0 && <T variant="muted" numberOfLines={1}>{top.map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${r.who} ${r.pts}`).join('   ')}</T>}
        <View style={[styles.meta, { justifyContent: 'space-between' }]}>
          <AvatarStack names={p.going} />
          <T variant="muted">{p.going.length} joined{me ? ` · you’re #${me.rank}` : ''} · {groupPoints(p)} pts together</T>
        </View>
      </View>
    </Card>
  );
}

export function NeedCard({ p }: { p: Plan }) {
  const T_ = PLAN_TYPES[p.type];
  const n = openCount(p);
  return (
    <Card onPress={() => open(p)}>
      <DateBlock p={p} />
      <View style={{ flex: 1, gap: 6 }}>
        <Chip label={T_.label} icon={T_.icon} tone={T_.tone} />
        <T variant="strong">{p.title}</T>
        <T variant="muted">{n} {p.days ? (n === 1 ? 'open meal' : 'open meals') : n === 1 ? 'spot open' : 'spots open'} · {p.time}</T>
      </View>
    </Card>
  );
}

export function PollCard({ p }: { p: Plan }) {
  const opts = p.options ?? [];
  const voters = new Set(opts.flatMap(o => o.v)).size;
  const lead = [...opts].sort((a, b) => b.v.length - a.v.length)[0];
  const mine = opts.some(o => o.v.includes('You'));
  return (
    <Card onPress={() => open(p)}>
      <DateBlock p={p} />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Chip label={p.kind === 'date' ? 'Date poll' : 'Poll'} icon="poll" tone="sky" />
          {mine && <Chip label="Voted" icon="check" tone="pine" />}
        </View>
        <T variant="strong">{p.title}</T>
        <T variant="muted">{lead?.v.length ? `Leading: ${lead.t} · ` : ''}{voters} voted · {p.closes}</T>
      </View>
    </Card>
  );
}

export function BeaconCard({ p }: { p: Plan }) {
  const { c } = useTheme();
  const coming = p.rsvp === 'going';
  return (
    <View style={[styles.beacon, { backgroundColor: c.emberSoft, borderColor: c.ember + '55' }]}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={[styles.flame, { backgroundColor: c.card }]}><Icon name="flame" color={c.ember} size={24} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.live, { color: c.ember }]}>HAPPENING NOW</Text>
          <T variant="heading">{p.host} · {p.title}</T>
          <T variant="muted">{p.when}{p.dist || p.where ? ` · ${p.dist ?? p.where}` : ''}</T>
        </View>
      </View>
      <View style={[styles.meta, { justifyContent: 'space-between' }]}>
        <AvatarStack names={p.going} />
        <T variant="muted">{p.going.length} {p.going.length === 1 ? 'neighbor' : 'neighbors'} headed over</T>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button grow kind={coming ? 'on' : 'ember'} icon={coming ? 'check' : undefined} label={coming ? 'You’re coming' : 'I’m coming'} onPress={() => { actions.rsvp(p.id, 'going'); if (!coming) toast(`${p.host} knows you’re on your way`); }} />
        <Button label="Details" onPress={() => open(p)} />
      </View>
    </View>
  );
}

// Maple Lake at dusk: treeline, beach, clubhouse, dock, a canoe, and a fire when a beacon is lit.
export function LakeScene({ fires }: { fires: number }) {
  const { c } = useTheme();
  const trees = Array.from({ length: 28 }, (_, i) => {
    const x = i * 13.5 - 8 + ((i * 37) % 7), h = 22 + ((i * 53) % 17);
    return `M${x} 96L${x + 8} ${96 - h}L${x + 16} 96Z`;
  }).join('');
  const stars = [[178, 10], [214, 30], [252, 16], [330, 22], [310, 44], [196, 48], [236, 52], [160, 60], [22, 64], [70, 70], [350, 60]];
  return (
    <View style={[styles.scene, { borderColor: c.line }]}>
      <Svg width="100%" height="100%" viewBox="0 0 360 150" preserveAspectRatio="xMidYMid slice">
        <Rect width="360" height="150" fill={c.dusk} />
        {stars.map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={i % 3 ? 0.9 : 1.4} fill={c.stars} />)}
        <Circle cx="292" cy="74" r="17" fill={c.emberSoft} />
        <Path d={trees} fill={c.tree} />
        <Rect y="96" width="360" height="54" fill={c.water} />
        <Path d="M52 96h30v3H52z" fill={c.tree} />
        <Path d="M104 121q15 5 30 0q-15 2-30 0z" fill={c.ember} />
        <Path d="M150 96h74l7 7h-88z" fill={c.sand} />
        <Path d="M236 86h16v10h-16z" fill={c.card} />
        <Path d="M30 112h46M112 132h60M206 116h52M262 134h46" stroke={c.dusk} strokeWidth="2" strokeLinecap="round" opacity={0.55} />
        {fires > 0 && <><Circle cx="318" cy="94" r="9" fill={c.ember} opacity={0.3} /><Circle cx="318" cy="94" r="3.5" fill={c.ember} /></>}
      </Svg>
      <View style={styles.cap}>
        <Text style={{ fontFamily: fonts.display, fontSize: 18, color: c.ink }}>Maple Lake</Text>
        <T variant="muted">{fires ? (fires === 1 ? 'A fire is lit tonight' : `${fires} fires are lit tonight`) : 'Quiet on the water tonight'}</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  date: { width: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, minHeight: 54 },
  dow: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1 },
  day: { fontFamily: fonts.display, fontSize: 20, lineHeight: 23 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: 9, overflow: 'hidden' },
  beacon: { borderRadius: 22, padding: 16, gap: 12, borderWidth: 1 },
  flame: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  live: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1 },
  scene: { height: 150, borderRadius: 22, overflow: 'hidden', borderWidth: 1 },
  cap: { position: 'absolute', left: 14, top: 11 },
});
