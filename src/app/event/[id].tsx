import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Icon } from '@/components/Icon';
import { openInMaps } from '@/data/address';
import { phaseOf } from '@/data/challenge';
import { accountForName, report, reportTarget } from '@/data/secure/sync';
import { ChallengeView } from '@/components/ChallengeView';
import { addToPhoneCalendar, calCopyOf, openInGoogleCalendar } from '@/data/calendarCopy';
import { Avatar, AvatarStack, Button, Chip, IconButton, ListBox, Notice, Pick, Row, Screen, Section, Segmented, T } from '@/components/ui';
import { PLAN_TYPES, POST_REACTIONS } from '@/data/planTypes';
import { actions, audienceText, canEdit, getState, isPast, slotsOf, useStore, whenText } from '@/data/store';
import type { Plan } from '@/data/types';
import { fonts, toneColors } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';

const MEAL_TIME = { Lunch: 'Drop off by noon', Dinner: 'Drop off by 5:30 PM' } as const;

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = useStore(s => s.plans.find(x => x.id === id));
  const hood = useStore(s => s.hood);
  const calPref = useStore(s => s.me.calPref);
  const { c } = useTheme();
  if (!p) return <Screen back title="Not found"><T>This plan is gone.</T></Screen>;
  const T_ = PLAN_TYPES[p.type];
  const [fg, bg] = toneColors(c, T_.tone);
  const secret = p.audience === 'except';
  const mealTrain = p.type === 'mealtrain';
  const canSeeAddr = p.host === 'You' || slotsOf(p).some(s => s.by === 'You');
  const isChallenge = p.type === 'challenge';
  // Finished: past its last day (challenges stay open for logging a few days after they end).
  const past = isChallenge && p.challenge ? phaseOf(p.challenge) === 'over' : isPast(p);
  const calendarable = !p.live && p.type !== 'poll' && !isChallenge && !past;
  // Add to your calendar: a saved choice adds straight away; otherwise show the options.
  const addToCalendar = async () => {
    if (p.calCopy) return router.push(`/calendar-add/${p.id}`);
    if (mealTrain && !slotsOf(p).some(s => s.by === 'You')) return toast('Sign up for a meal first, then add your drop-off to your calendar');
    if (!calPref) return router.push(`/calendar-add/${p.id}`);
    const copy = calCopyOf(p);
    if (calPref === 'google') { await openInGoogleCalendar(copy); actions.setCalCopy(p.id, { via: 'google' }); return toast('Using your saved choice. Opened in Google Calendar.'); }
    if (await addToPhoneCalendar(copy)) { actions.setCalCopy(p.id, { via: 'phone' }); toast('Using your saved choice. Added to your phone calendar.'); }
    else router.push(`/calendar-add/${p.id}`);
  };

  return (
    <Screen back right={calendarable ? <IconButton name={p.calCopy ? 'check' : 'cal'} label={p.calCopy ? 'In your calendar' : 'Add to your calendar'} active={!!p.calCopy} onPress={addToCalendar} /> : undefined}>
      <View style={[styles.hero, { backgroundColor: bg }]}>
        <View style={{ alignSelf: 'flex-start', backgroundColor: c.card, borderRadius: 99 }}>
          <Chip label={`${T_.label}${p.live ? ' · live' : ''}`} icon={T_.icon} tone={T_.tone} />
        </View>
        <Text style={[styles.h1, { color: c.ink }]}>{p.title}</Text>
        <View style={{ gap: 6 }}>
          {mealTrain ? <>
            {!p.title.toLowerCase().includes((p.for ?? '').toLowerCase()) && <Fact icon="heart" color={fg} text={`Meals for ${p.for}`} />}
            <Fact icon="user" color={fg} text={`Organized by ${p.host}`} />
            <Fact icon="clock" color={fg} text={`${p.days?.[0]?.d} to ${p.days?.[p.days.length - 1]?.d}`} />
            <Fact icon="pin" color={fg} text={canSeeAddr ? p.address ?? '' : 'Address shown once you sign up for a meal'} />
          </> : <>
            <Fact icon="user" color={fg} text={`Hosted by ${p.host}`} />
            {p.type !== 'poll' && <Fact icon="clock" color={fg} text={whenText(p)} />}
            {p.type === 'poll' ? <Fact icon="clock" color={fg} text={p.closes ?? ''} /> : !!p.where && <Fact icon="pin" color={fg} text={p.where} />}
            {!!p.mapAddress && (
              <Pressable onPress={() => openInMaps(p.mapAddress!)} accessibilityRole="link" accessibilityLabel={`Directions to ${p.mapAddress}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Icon name="route" size={16} color={fg} />
                <Text style={{ flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: c.pine, textDecorationLine: 'underline' }}>{p.mapAddress}</Text>
              </Pressable>
            )}
            {!!p.route && <Fact icon="route" color={fg} text={p.route} />}
          </>}
        </View>
      </View>

      {!!p.note && <T>{p.note}</T>}
      <PostReactions p={p} />
      <Notice icon={secret ? 'eyeoff' : 'lock'} title={audienceText(p, hood)}>
        {secret ? 'They won’t see this plan, its chat or any reminders.' : isChallenge ? 'Only people who can see this challenge see its leaderboard and log.' : 'Only people who can see this plan get its details.'}{p.precision ? ` Location: ${p.precision}.` : ''}
      </Notice>

      {past && <Notice icon="clock" title="This one’s over">Finished plans stay for 3 months so you can copy one for next time.</Notice>}
      {past && <Button kind="primary" icon="plus" label="Copy for a new date" onPress={() => router.push(`/create/${p.type}?from=${p.id}`)} />}
      {p.type === 'poll' && <Poll p={p} />}
      {isChallenge && <ChallengeView p={p} />}
      {!mealTrain && p.type !== 'poll' && !isChallenge && !past && <Rsvp p={p} />}
      {p.lists && <SignupLists p={p} />}
      {mealTrain && <MealTrain p={p} canSeeAddr={canSeeAddr} />}
      {!p.live && !past && <Reminders p={p} />}
      {calendarable && <Button icon={p.calCopy ? 'check' : 'cal'} label={p.calCopy ? `In your ${p.calCopy.via === 'google' ? 'Google Calendar' : 'phone calendar'}` : 'Add to your calendar'} onPress={addToCalendar} />}

      <Button icon="chat" label="Open the plan’s chat" onPress={() => router.push(`/chat/${actions.openChatFor(p.id)}`)} />
      {!past && p.type !== 'poll' && !p.live && <Button icon="plus" label="Copy this plan" onPress={() => router.push(`/create/${p.type}?from=${p.id}`)} />}
      {p.host !== 'You' && hood.remote && (() => {
        const acct = accountForName(p.host);
        const target = acct ? reportTarget(acct) : null;
        if (!acct || !target || target.iAmOwner || !target.ownersOther.length) return null;
        return (
          <Pressable onPress={() => Alert.alert('Report this plan?', `A report goes to the owners of ${target.hoodName}, encrypted, with the plan’s title and details. ${p.host} isn’t told who reported it.`,
            [{ text: 'Cancel', style: 'cancel' }, { text: 'Report', style: 'destructive', onPress: () => {
              report(target, { about: acct, aboutName: p.host, kind: 'plan', text: `${p.title}${p.note ? ` — ${p.note}` : ''}`, where: p.title });
              toast('Reported to the owners. Only they see it.');
            } }])} accessibilityRole="button" style={{ padding: 10 }}>
            <T variant="muted" style={{ textAlign: 'center' }}>Report this plan</T>
          </Pressable>
        );
      })()}
      {canEdit(p, 'You') && !past && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!p.live && <Button grow label={p.type === 'challenge' ? 'Edit challenge' : p.type === 'poll' ? 'Edit poll' : 'Edit plan'} onPress={() => router.push(`/create/${p.type}?edit=${p.id}`)} />}
          {p.host === 'You' && <Button grow kind="danger" label={p.live ? 'Put it out' : 'Cancel plan'} onPress={() => Alert.alert(p.live ? 'Put out this beacon?' : `Cancel ${p.title}?`,
            'It disappears for everyone, along with its chat. This can’t be undone.',
            [{ text: 'Keep it', style: 'cancel' }, { text: p.live ? 'Put it out' : 'Cancel plan', style: 'destructive', onPress: () => { actions.cancelPlan(p.id); router.back(); toast(p.live ? 'Beacon is out.' : 'Plan cancelled.'); } }])}/>}
        </View>
      )}
    </Screen>
  );
}

function Fact({ icon, color, text }: { icon: 'user' | 'clock' | 'pin' | 'heart' | 'route'; color: string; text: string }) {
  return <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Icon name={icon} size={16} color={color} /><T style={{ flex: 1 }}>{text}</T></View>;
}

function PostReactions({ p }: { p: Plan }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {POST_REACTIONS.map(([e, label]) => {
        const l = p.r?.[e] ?? [], mine = l.includes('You');
        return (
          <Pressable key={e} onPress={() => actions.reactPost(p.id, e)} accessibilityRole="button" accessibilityLabel={`${label}${l.length ? `, ${l.length}` : ''}`} accessibilityState={{ selected: mine }}
            style={[styles.react, { borderColor: mine ? c.pine : c.line, backgroundColor: mine ? c.pineSoft : c.card }]}>
            <Text style={{ fontSize: 15 }}>{e}</Text>{l.length > 0 && <Text style={{ fontFamily: fonts.bodyBold, fontSize: 13, color: c.ink }}>{l.length}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

function Rsvp({ p }: { p: Plan }) {
  const [open, setOpen] = useState(false);
  const help = p.type === 'help', maybe = p.maybe ?? [];
  return (
    <Section title={help ? 'Can you help?' : 'Are you going?'}>
      <Segmented options={[['going', help ? 'I’ll help' : 'Going'], ['maybe', 'Maybe'], ['no', 'Can’t make it']]} value={p.rsvp ?? ('' as never)} onChange={k => { actions.rsvp(p.id, k); const g = getState().plans.find(x => x.id === p.id)!; if (g.rsvp === 'going') toast(help ? `${p.host} knows you’re helping. Thank you!` : g.remind?.length ? `You’re going. We’ll remind you: ${g.remind.join(', ').toLowerCase()}.` : 'You’re going.'); }} />
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AvatarStack names={p.going} max={7} />
        <T variant="muted">{p.going.length} {help ? 'helping' : 'going'}{maybe.length ? ` · ${maybe.length} maybe` : ''} · {open ? 'Hide' : 'See who'}</T>
      </Pressable>
      {open && (
        <ListBox>
          {[...p.going.map(n => [n, n === p.host ? 'Host' : help ? 'Helping' : 'Going']), ...maybe.map(n => [n, 'Maybe'])].map(([n, label], i) => (
            <Row key={n + label} first={i === 0}>
              <Avatar name={n} size={36} ring={false} />
              <T variant="strong" style={{ flex: 1, fontSize: 15 }}>{n}</T>
              <Chip label={label} tone={label === 'Maybe' ? 'ember' : 'pine'} />
            </Row>
          ))}
        </ListBox>
      )}
    </Section>
  );
}

function SignupLists({ p }: { p: Plan }) {
  const { c } = useTheme();
  const [draft, setDraft] = useState('');
  const claimLabel = p.type === 'help' ? 'I’m in' : p.type === 'paddle' ? 'Claim' : 'I’ll bring it';
  const title = ({ potluck: 'The menu', paddle: 'Gear & sign-ups', help: 'What’s needed' } as Record<string, string>)[p.type] ?? 'Who’s bringing what';
  return (
    <Section title={title}>
      <ListBox>
        {p.lists!.map((l, li) => (
          <View key={l.cat}>
            <Text style={[styles.cat, { color: c.muted, borderTopColor: c.line, borderTopWidth: li ? 1 : 0 }]}>{l.cat.toUpperCase()}</Text>
            {l.items.map((it, ii) => (
              <Row key={ii}>
                <View style={{ flex: 1 }}>
                  <T variant="strong" style={{ fontSize: 15 }}>{it.name}</T>
                  {it.by && it.by !== 'You' && <T variant="muted">{it.by}</T>}
                </View>
                {it.by && it.by !== 'You' ? <Avatar name={it.by} />
                  : <Button kind={it.by === 'You' ? 'primary' : 'default'} icon={it.by === 'You' ? 'check' : undefined} label={it.by === 'You' ? 'You' : claimLabel} onPress={() => { actions.claimItem(p.id, li, ii); if (!it.by) toast(`You’re down for: ${it.name}`); }} />}
              </Row>
            ))}
          </View>
        ))}
        <View style={[styles.addRow, { borderTopColor: c.line }]}>
          <TextInput value={draft} onChangeText={setDraft} placeholder={p.type === 'help' ? 'Add something else that’s needed' : 'Add something you’ll bring'} placeholderTextColor={c.muted}
            style={[styles.input, { borderColor: c.line, color: c.ink, backgroundColor: c.surface }]} accessibilityLabel="Add an item" />
          <Button label="Add" onPress={() => { if (draft.trim()) { actions.addItem(p.id, draft.trim()); toast(`Added ${draft.trim()}`); setDraft(''); } }} />
        </View>
      </ListBox>
    </Section>
  );
}

function MealTrain({ p, canSeeAddr }: { p: Plan; canSeeAddr: boolean }) {
  const { c } = useTheme();
  const organizer = p.host === 'You';
  const slots = slotsOf(p), open = slots.filter(s => !s.by).length;
  let next: { di: number; si: number; meal: string; day: string } | null = null;
  p.days!.forEach((d, di) => d.slots.forEach((s, si) => { if (!s.by && !next) next = { di, si, meal: s.meal, day: d.d }; }));
  const n = next as { di: number; si: number; meal: string; day: string } | null;
  const signed = p.days!.flatMap(d => d.slots.filter(s => s.by).map(s => ({ ...s, day: d.d })));
  return (
    <>
      <View style={[styles.mtsum, { backgroundColor: c.emberSoft, borderColor: c.ember + '44' }]}>
        <View style={{ flex: 1 }}>
          <T variant="heading">{open ? `${open} ${open === 1 ? 'meal' : 'meals'} still needed` : 'Every meal is covered'}</T>
          <T variant="muted">{n ? `Next open: ${n.meal.toLowerCase()} on ${n.day}` : 'Thank you, neighbors!'}</T>
        </View>
        {n && <Button kind="ember" label="Take it" onPress={() => { actions.claimMeal(p.id, n.di, n.si); toast(`You’re bringing ${n.meal.toLowerCase()} on ${n.day}. We’ll remind you that morning.`); }} />}
      </View>
      <Notice icon="heart" title="Allergies and preferences">{p.diet}</Notice>
      <Notice icon="pin" title="Drop-off">{canSeeAddr ? `${p.address} · ` : ''}{p.dropoff}{canSeeAddr ? '' : ' You’ll see the address once you sign up for a meal.'}</Notice>
      {signed.length > 0 && (
        <Section title="Who’s signed up">
          <ListBox>{signed.map((s, i) => (
            <Row key={i} first={i === 0}><Avatar name={s.by!} size={36} ring={false} />
              <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>{s.by}</T><T variant="muted">{s.meal} on {s.day}{s.what ? ` · ${s.what}` : ''}</T></View>
            </Row>))}
          </ListBox>
        </Section>
      )}
      <Section title="Meal schedule">
        {organizer && <T variant="muted">You organized this. Tap + to add a meal to a day, or × to remove an open one. Remove every meal to mark a day as not needed.</T>}
        {p.days!.map((day, di) => (
          <ListBox key={day.d}>
            <View style={[styles.mdh, { backgroundColor: c.surface, borderBottomColor: c.line }]}>
              <T variant="strong" style={{ fontSize: 15, flex: 1 }}>{day.d}</T>
              {organizer && (['Lunch', 'Dinner'] as const).filter(m => !day.slots.some(sl => sl.meal === m)).map(m => (
                <Pick key={m} label={`+ ${m}`} onPress={() => { actions.addMeal(p.id, di, m); toast(`${m} added for ${day.d}`); }} />
              ))}
            </View>
            {day.slots.length ? day.slots.map((sl, si) => (
              <View key={si}>
                <Row first>
                  <Text style={[styles.mealtag, { color: c.sky }]}>{sl.meal.toUpperCase()}</Text>
                  <View style={{ flex: 1 }}>
                    <T variant="strong" style={{ fontSize: 15 }}>{sl.by ? (sl.by === 'You' ? 'You' : sl.by) : 'Open'}</T>
                    <T variant="muted">{sl.by ? sl.what || `Bringing ${sl.meal.toLowerCase()}` : MEAL_TIME[sl.meal]}</T>
                  </View>
                  {organizer && !sl.by && <IconButton name="x" label={`Remove ${sl.meal} on ${day.d}`} onPress={() => { actions.removeMeal(p.id, di, si); toast(day.slots.length > 1 ? `${sl.meal} removed for ${day.d}` : `${day.d} marked as not needed`); }} />}
                  {sl.by && sl.by !== 'You' ? <Avatar name={sl.by} />
                    : <Button kind={sl.by === 'You' ? 'primary' : 'default'} label={sl.by === 'You' ? 'You' : 'Sign up'} icon={sl.by === 'You' ? 'check' : undefined} onPress={() => { actions.claimMeal(p.id, di, si); if (!sl.by) toast(`You’re bringing ${sl.meal.toLowerCase()} on ${day.d}. We’ll remind you that morning.`); }} />}
                </Row>
                {sl.by === 'You' && (
                  <View style={[styles.addRow, { borderTopColor: c.line }]}>
                    <TextInput defaultValue={sl.what} accessibilityLabel={`What you’re bringing for ${sl.meal}`} placeholder="What are you bringing? (optional)" placeholderTextColor={c.muted}
                      onEndEditing={e => actions.setMealNote(p.id, di, si, e.nativeEvent.text)} style={[styles.input, { borderColor: c.line, color: c.ink, backgroundColor: c.surface }]} />
                  </View>
                )}
              </View>
            )) : <Row first><T variant="muted">{day.note ?? 'No meals needed this day'}</T></Row>}
          </ListBox>
        ))}
      </Section>
    </>
  );
}

function Poll({ p }: { p: Plan }) {
  const { c } = useTheme();
  const makePlan = (o: { t: string; iso?: string }) => {
    router.push({ pathname: '/create/[type]', params: { type: 'gathering', title: p.title.replace(/^When should we (do )?/i, '').replace(/\?$/, '').replace(/^./, ch => ch.toUpperCase()), date: o.iso ?? '', note: `Date picked by poll: ${o.t}.` } });
    toast(`${o.t} won. Set the time and post it.`);
  };
  const opts = p.options ?? [];
  const max = Math.max(1, ...opts.map(o => o.v.length));
  const lead = [...opts].sort((a, b) => b.v.length - a.v.length)[0];
  const voters = new Set(opts.flatMap(o => o.v)).size;
  return (
    <Section title={p.multi ? 'Pick every option that works for you' : 'Tap one to vote'} right={<T variant="muted">{voters} voted</T>}>
      {opts.map((o, i) => {
        const me = o.v.includes('You');
        return (
          <Pressable key={o.t} onPress={() => { actions.vote(p.id, i); if (!me) toast(p.multi ? `Marked ${o.t} as working for you` : `You voted ${o.t}`); }} accessibilityRole="button" accessibilityState={{ selected: me }}
            style={[styles.opt, { borderColor: me ? c.pine : c.line, backgroundColor: c.card }]}>
            <View style={[StyleSheet.absoluteFill, { width: `${(o.v.length / max) * 100}%`, backgroundColor: c.skySoft }]} />
            <View style={[styles.box, { borderRadius: p.multi ? 7 : 11, backgroundColor: me ? c.pine : c.card, borderColor: me ? c.pine : c.line }]}>{me && <Icon name="check" size={14} color={c.onPine} />}</View>
            <View style={{ flex: 1, gap: 4 }}><T variant="strong" style={{ fontSize: 15 }}>{o.t}</T>{o.v.length > 0 && <AvatarStack names={o.v} max={4} />}</View>
            {lead === o && o.v.length > 0 && <Chip label="Leading" tone="pine" />}
            <T variant="strong">{o.v.length}</T>
          </Pressable>
        );
      })}
      {p.kind === 'date' && lead && lead.v.length > 0 && <Button kind="primary" icon="cal" label={`Make it a plan for ${lead.t}`} onPress={() => makePlan(lead)} />}
    </Section>
  );
}

function Reminders({ p }: { p: Plan }) {
  const opts = p.type === 'poll' ? ['Before voting closes'] : p.type === 'mealtrain' ? ['Day before my meal', 'Morning of my meal'] : p.type === 'challenge' ? ['Evening nudge to log', 'Last day'] : ['Day before', 'Morning of', '1 hour before'];
  const on = p.remind ?? [];
  return (
    <Section title="Remind me">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {opts.map(o => <Pick key={o} label={o} on={on.includes(o)} onPress={() => { actions.toggleRemind(p.id, o); toast(on.includes(o) ? 'Reminder removed' : `Reminder set: ${o.toLowerCase()}`); }} />)}
      </View>
      <T variant="muted">{on.length ? `You’ll get a notification: ${on.join(', ').toLowerCase()}.` : 'No reminders set. Tap one to get a notification.'}</T>
    </Section>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 24, padding: 18, gap: 10 },
  h1: { fontFamily: fonts.logo, fontSize: 29, lineHeight: 33 },
  react: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1 },
  cat: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 },
  addRow: { flexDirection: 'row', gap: 8, padding: 10, paddingHorizontal: 14, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, height: 40, fontFamily: fonts.body, fontSize: 15 },
  mtsum: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  mdh: { paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1 },
  mealtag: { width: 64, fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.6 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  box: { width: 22, height: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
