import { PausedScreen, useHoodPaused } from '@/components/PlanNotice';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PeoplePicker } from '@/components/PeoplePicker';
import { DatePicker, fromISO, prettyDate, toISO, type ISODate } from '@/components/DatePicker';
import { TimeField, formatTime, parseTime } from '@/components/TimeField';
import { Button, IconButton, Pick, Screen, Section, Segmented, T } from '@/components/ui';
import { checkAddress } from '@/data/address';
import { rulesText, scoreEntries, TEMPLATES } from '@/data/challenge';
import { FORM_SPECS } from '@/data/formSpecs';
import { PLAN_TYPES } from '@/data/planTypes';
import { actions, canEdit, getState, hoodCount, useStore } from '@/data/store';
import type { Audience, Challenge, ChallengeLevel, ChallengeMode, ChallengeTeams, Plan, PlanType } from '@/data/types';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';

const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
const daysBetween = (a: ISODate, b: ISODate) => Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 864e5) + 1;
// Plans that can run over several days (a camping trip, a work weekend).
const MULTI_DAY: PlanType[] = ['gathering', 'walk', 'paddle', 'games', 'help', 'potluck', 'surprise'];
type Who = 'all' | 'pick' | 'except' | `cal:${string}`;
const newPlanId = () => `p${Date.now()}`;

function CreatePlan() {
  const params = useLocalSearchParams<{ type: PlanType; title?: string; date?: string; note?: string; from?: string; edit?: string }>();
  // "Copy" opens this form filled in from another plan (everything except the dates).
  // "Edit" (host only) fills in everything, dates included, and saves over the same plan.
  const editing: Plan | undefined = params.edit ? getState().plans.find(x => x.id === params.edit && canEdit(x, 'You')) : undefined;
  // Polls and meal trains keep their dates once posted (votes and meal sign-ups hang on them).
  const fixedDates = !!editing && (editing.type === 'poll' || editing.type === 'mealtrain');
  // Only the host chooses who else can edit.
  const iAmHost = !editing || editing.host === 'You';
  const src: Plan | undefined = editing ?? (params.from ? getState().plans.find(x => x.id === params.from) : undefined);
  const isoOf = (p: Plan) => `${p.y ?? 2026}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  const kind: PlanType = src?.type ?? (params.type && PLAN_TYPES[params.type] ? params.type : 'gathering');
  const t = PLAN_TYPES[kind];
  const spec = FORM_SPECS[kind];
  const { c } = useTheme();
  const hood = useStore(s => s.hood);
  const street = useStore(s => s.me.street);
  const cals = useStore(s => s.cals);
  const today = toISO(new Date());

  const [title, setTitle] = useState(params.title ?? src?.title ?? '');
  const [date, setDate] = useState<ISODate | null>(params.date || (editing && !editing.end ? isoOf(editing) : null));
  const [multi, setMulti] = useState<'one' | 'several'>(editing?.end ? 'several' : 'one');
  const [time, setTime] = useState(editing?.time ? parseTime(editing.time, spec.when.kind === 'datetime' ? spec.when.defaultTime : '22:00') : spec.when.kind === 'datetime' ? spec.when.defaultTime : '22:00');
  const [nowWhen, setNowWhen] = useState<'Now' | 'Next hour' | 'Tonight'>('Now');
  const [range, setRange] = useState<[ISODate | null, ISODate | null]>(editing?.challenge ? [editing.challenge.start, editing.challenge.end] : editing?.end ? [isoOf(editing), editing.end] : [null, null]);
  const [pollKind, setPollKind] = useState<'date' | 'yesno' | 'choice'>('date');
  const [pollDates, setPollDates] = useState<ISODate[]>([]);
  const [closes, setCloses] = useState<ISODate | null>(null);
  const picks = (spec.place?.picks ?? []).filter(p => p === 'My place' || hood.places.includes(p));
  // Lake and beach ideas only appear in neighborhoods that have a lake or beach.
  const suggestions = (spec.suggestions ?? []).flatMap(x => (typeof x === 'string' ? [x] : hood.places.includes(x[1]) ? [x[0]] : []));
  const srcPlaceIsPick = !!src?.where && picks.includes(src.where);
  const srcIsOther = !!src?.where && !srcPlaceIsPick && !src.where.startsWith('Your place');
  // "Other" reveals a text box for any place that isn't one of the picks.
  const [place, setPlace] = useState(srcPlaceIsPick ? src!.where : srcIsOther || !picks.length ? 'Other' : picks[0]);
  const [placeText, setPlaceText] = useState(srcIsOther ? src!.where : '');
  const [addr, setAddr] = useState(src?.mapAddress ?? '');
  const [addrState, setAddrState] = useState<'idle' | 'checking' | 'ok' | 'none'>(src?.mapAddress ? 'ok' : 'idle');
  const [route, setRoute] = useState(src?.route ?? '');
  const [who, setWho] = useState<Who>(src ? (src.audience as Who) : (spec.defaultAudience ?? 'all'));
  const [picked, setPicked] = useState<string[]>(src?.invited ?? src?.excluded ?? []);
  const [list, setList] = useState(src?.lists?.flatMap(l => l.items.map(i => i.name)).join('\n') ?? '');
  const [details, setDetails] = useState(params.note ?? src?.note ?? '');
  const [mtFor, setMtFor] = useState(src?.for ?? '');
  const [mtAddr, setMtAddr] = useState(src?.address ?? '');
  const [mtDrop, setMtDrop] = useState(src?.dropoff ?? '');
  const [meals, setMeals] = useState<('Lunch' | 'Dinner')[]>(['Dinner']);
  const [editorsOn, setEditorsOn] = useState<'me' | 'others'>(editing?.editors?.length ? 'others' : 'me');
  const [editors, setEditors] = useState<string[]>(editing?.editors ?? []);

  // ---------- challenge settings ----------
  const srcCh = src?.challenge;
  const [chMode, setChMode] = useState<ChallengeMode>(srcCh?.mode ?? 'time');
  const tpl = TEMPLATES[chMode];
  const [chCounts, setChCounts] = useState<string[]>(srcCh?.counts ?? tpl.counts);
  const [chExtra, setChExtra] = useState('');
  const [chPer, setChPer] = useState(String(srcCh?.per ?? tpl.per));
  const [chUnit, setChUnit] = useState(srcCh?.unit ?? tpl.unit ?? '');
  const [chLevels, setChLevels] = useState<ChallengeLevel[]>(srcCh?.levels ?? tpl.levels);
  const [chTasks, setChTasks] = useState((srcCh?.tasks ?? tpl.tasks ?? []).map(x => `${x.name} = ${x.pts}`).join('\n'));
  const [chSignup, setChSignup] = useState<ISODate | null>(editing?.challenge?.signupBy ?? null);
  // Editing a challenge: once anyone has logged, the scoring rules stay as they were so no one's points change.
  // Once it has started, its first day stays put.
  const scoreLocked = !!editing?.challenge?.log.length;
  const startedOn = editing?.challenge && editing.challenge.start <= today ? editing.challenge.start : null;
  const [chTeamsOn, setChTeamsOn] = useState<'none' | 'teams'>(srcCh?.teams ? 'teams' : 'none');
  const [chTeamNames, setChTeamNames] = useState(srcCh?.teams?.names.join(', ') ?? 'Team 1, Team 2');
  const [chAssign, setChAssign] = useState<ChallengeTeams['assign']>(srcCh?.teams?.assign ?? 'choose');
  const [chIn, setChIn] = useState<'in' | 'out'>('in');
  const pickMode = (m: ChallengeMode) => {
    const x = TEMPLATES[m];
    setChMode(m); setChCounts(x.counts); setChPer(String(x.per)); setChUnit(x.unit ?? ''); setChLevels(x.levels);
    setChTasks((x.tasks ?? []).map(k => `${k.name} = ${k.pts}`).join('\n'));
  };
  const addActivity = () => { const v = chExtra.trim(); if (v && !chCounts.includes(v)) setChCounts(x => [...x, v]); setChExtra(''); };
  const parsedTasks = lines(chTasks)
    .map(l => { const m = /^(.*?)\s*[=:]\s*(\d+)\s*$/.exec(l); return m ? { name: m[1].trim(), pts: Number(m[2]) } : { name: l, pts: 1 }; })
    .filter(x => x.name);
  const teamNames = chTeamNames.split(',').map(x => x.trim()).filter(Boolean);
  const draftCh: Challenge = {
    mode: chMode, start: range[0] ?? today, end: range[1] ?? today, signupBy: chSignup ?? range[0] ?? today,
    per: Math.max(0.1, Number(chPer) || 1), unit: chUnit.trim() || tpl.unit, levels: chLevels,
    tasks: chMode === 'tasks' ? parsedTasks : undefined, counts: chMode === 'count' ? [chUnit.trim() || 'Count'] : chCounts, log: [],
  };
  const example = (() => {
    if (chMode === 'tasks') return parsedTasks[0] ? `Example: doing “${parsedTasks[0].name}” twice = ${parsedTasks[0].pts * 2} points.` : '';
    if (chMode === 'checkin') return `Example: checking in 5 days = ${5 * (chLevels[0]?.pts ?? 1)} points.`;
    const per = draftCh.per, u = chMode === 'time' ? 'minutes' : draftCh.unit;
    const a = Math.round(per * 3.4 * 10) / 10, lvl = chLevels.length - 1;
    const pts = scoreEntries([{ id: 'x', who: 'x', day: today, what: '', amount: a, level: lvl }], draftCh);
    return `Example: ${a} ${u}${chLevels.length > 1 ? ` at ${chLevels[lvl].name.toLowerCase()} effort` : ''} = ${pts} points (${Math.floor(a / per + 1e-9)} full blocks of ${per}). The leftover carries over to the next entry.`;
  })();

  const [error, setError] = useState('');
  const multiDay = MULTI_DAY.includes(kind) && spec.when.kind === 'datetime' && multi === 'several';

  const verifyAddress = async () => {
    if (!addr.trim()) return;
    setAddrState('checking');
    const r = await checkAddress(addr);
    if (r) { setAddr(r.formatted); setAddrState('ok'); } else setAddrState('none');
  };

  const post = () => {
    setError('');
    const fail = (m: string) => setError(m);
    if (kind === 'poll' && !title.trim()) return fail('Write a question first.');
    if (iAmHost && editorsOn === 'others' && !editors.length) return fail('Pick who else can edit, or choose Just me.');
    const options = kind !== 'poll' ? [] : pollKind === 'yesno' ? ['Yes', 'No'] : pollKind === 'date' ? pollDates.map(d => prettyDate(d)) : lines(list);
    if (!fixedDates) {
    if (spec.when.kind === 'datetime' && !multiDay && !date) return fail('Pick a date on the calendar.');
    if (multiDay && !(range[0] && range[1])) return fail('Pick the first and last day.');
    if (spec.when.kind === 'range' && !(range[0] && range[1])) return fail(kind === 'challenge' ? 'Pick the first and last day of the challenge.' : 'Pick the first and last day of the meal train.');
    if (kind === 'challenge') {
      if (chMode === 'tasks' && !parsedTasks.length) return fail('Add at least one task, like “Rake leaves = 3”.');
      if ((chMode === 'time' || chMode === 'distance') && !chCounts.length) return fail('Pick at least one activity that counts.');
      if (chMode === 'count' && !chUnit.trim()) return fail('Say what’s being counted, like push-ups or books.');
      if (!(Number(chPer) > 0)) return fail('The block size has to be more than 0.');
      if (chLevels.some(l => !l.name.trim())) return fail('Give every effort level a name.');
      if (chTeamsOn === 'teams' && teamNames.length < 2) return fail('Name at least two teams, separated by commas.');
      if (chSignup && range[1] && chSignup > range[1]) return fail('Sign-up has to close before the challenge ends.');
      if (startedOn && range[0] !== startedOn) return fail(`It already started, so it has to start ${prettyDate(startedOn)}. You can change the last day.`);
      if (editing && range[1] && range[1] < today) return fail('Pick a last day that’s today or later.');
    }
    if (kind === 'mealtrain' && !mtFor.trim()) return fail('Add who the meals are for.');
    if (spec.place && place === 'Other' && !placeText.trim() && !addr.trim()) return fail('Say where it is, or add an address.');
    if ((who === 'pick' || who === 'except') && !picked.length) return fail(who === 'except' ? 'Pick who shouldn’t see it.' : 'Pick at least one neighbor.');
    if (kind === 'poll' && options.length < 2) return fail(pollKind === 'date' ? 'Pick at least two dates to vote on.' : 'Add at least two choices, one per line.');
    if (kind === 'poll' && !closes) return fail('Pick when voting closes.');
    }

    const anchor = fixedDates ? fromISO(`${editing!.y ?? 2026}-${String(editing!.m).padStart(2, '0')}-${String(editing!.d).padStart(2, '0')}`)
      : fromISO(spec.when.kind === 'range' || multiDay ? range[0]! : spec.when.kind === 'poll' ? closes! : date ?? today);
    // A real street address beats the default "My place" pick, so the two never contradict.
    const where = place === 'Other' ? placeText.trim() : (place === 'My place' ? (addr.trim() ? '' : street ? `Your place, ${street}` : 'Your place') : place);
    const p: Plan = {
      id: newPlanId(), type: kind, host: 'You',
      title: title.trim() || (kind === 'mealtrain' ? `Meals for ${mtFor.trim()}` : t.label),
      y: anchor.getFullYear(), m: anchor.getMonth() + 1, d: anchor.getDate(), dow: anchor.toLocaleDateString('en-US', { weekday: 'short' }),
      time: spec.when.kind === 'datetime' ? formatTime(time) : '',
      where: spec.place ? where : '', precision: place === 'My place' && !addr.trim() ? 'approximate' : 'shared with guests',
      audience: who as Audience, invited: who === 'pick' ? picked : undefined, excluded: who === 'except' ? picked : undefined,
      going: ['You'], rsvp: 'going', note: details.trim() || null,
      ...(multiDay ? { end: range[1]! } : {}),
      ...(spec.place && addr.trim() ? { mapAddress: addr.trim() } : {}),
    };
    if (spec.route && route.trim()) Object.assign(p, { route: route.trim(), pace: '', recurring: 'One time' });
    if (spec.list) p.lists = [{ cat: spec.list.category, items: (lines(list).length ? lines(list) : spec.list.defaults).map(name => ({ name, by: null })) }];
    if (kind === 'beacon') Object.assign(p, { live: true, going: [], rsvp: null, when: nowWhen === 'Now' ? `Now until ${formatTime(time)}` : nowWhen === 'Next hour' ? `Starting within the hour, until ${formatTime(time)}` : `Tonight until ${formatTime(time)}` });
    if (kind === 'poll' && !fixedDates) Object.assign(p, { going: [], rsvp: null, where: '', kind: pollKind, multi: pollKind === 'date', closes: `Closes ${prettyDate(closes!)}`, options: options.map(o => ({ t: o, v: [] })) });
    if (kind === 'challenge') {
      const n = daysBetween(range[0]!, range[1]!);
      const teams: ChallengeTeams | undefined = chTeamsOn === 'teams' ? { names: teamNames, assign: chAssign, of: {} } : undefined;
      // If people pick their own team, the organizer picks theirs on the challenge page like everyone else.
      const signMeUp = chIn === 'in' && !(teams && teams.assign === 'choose');
      Object.assign(p, {
        where: '', precision: '', time: `${n} ${n === 1 ? 'day' : 'days'}`,
        going: signMeUp ? ['You'] : [], rsvp: signMeUp ? 'going' : null,
        challenge: { ...draftCh, start: range[0]!, end: range[1]!, signupBy: chSignup ?? range[0]!, teams } satisfies Challenge,
      });
    }
    if (kind === 'mealtrain' && !fixedDates) {
      const n = daysBetween(range[0]!, range[1]!);
      Object.assign(p, {
        going: [], rsvp: null, for: mtFor.trim(), where: `For ${mtFor.trim()}`, precision: 'address shown to people who sign up',
        address: mtAddr.trim() || 'Ask the organizer', dropoff: mtDrop.trim() || 'Ask the organizer for drop-off details.', diet: list.trim() || 'None given',
        time: `${meals.join(' and ')} · ${n} ${n === 1 ? 'day' : 'days'}`,
        days: Array.from({ length: n }, (_, i) => ({
          d: new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          slots: (['Lunch', 'Dinner'] as const).filter(m => meals.includes(m)).map(meal => ({ meal, by: null })),
        })),
      });
    }
    if (editing) {
      const next: Plan = {
        ...editing, title: p.title, y: p.y, m: p.m, d: p.d, dow: p.dow, time: p.time, where: p.where, precision: p.precision,
        audience: p.audience, invited: p.invited, excluded: p.excluded, note: p.note, route: p.route ?? editing.route,
        end: p.end, mapAddress: p.mapAddress,
      };
      if (kind === 'challenge' && editing.challenge && p.challenge) {
        const was = editing.challenge, now = p.challenge;
        next.challenge = { ...was, start: now.start, end: now.end, signupBy: now.signupBy,
          ...(scoreLocked ? {} : { mode: now.mode, per: now.per, unit: now.unit, levels: now.levels, tasks: now.tasks, counts: now.counts }) };
        next.going = editing.going; next.rsvp = editing.rsvp;
      }
      if (iAmHost) next.editors = editorsOn === 'others' ? editors.filter(n => n !== 'You') : [];
      if (fixedDates) Object.assign(next, { y: editing.y, m: editing.m, d: editing.d, dow: editing.dow, time: editing.time, end: editing.end, where: editing.where, precision: editing.precision });
      if (editing.type === 'mealtrain') Object.assign(next, { for: mtFor.trim() || editing.for, where: `For ${mtFor.trim() || editing.for}`, address: mtAddr.trim() || editing.address, dropoff: mtDrop.trim() || editing.dropoff, diet: list.trim() || editing.diet });
      if (!p.end) delete next.end;
      if (!p.mapAddress) delete next.mapAddress;
      actions.editPlan(next);
      router.back();
      return toast('Saved. Everyone invited sees the change.');
    }
    if (editorsOn === 'others' && editors.length) p.editors = editors.filter(n => n !== 'You');
    actions.addPlan(p);
    router.dismissAll();
    router.push(`/event/${p.id}`);
    toast(kind === 'beacon' ? 'Beacon lit. Neighbors who can see it were notified.' : kind === 'surprise' && p.excluded?.length ? `Posted. ${p.excluded.join(', ')} can’t see it.` : kind === 'help' ? 'Asked. Neighbors will see it under “Neighbors need a hand.”' : kind === 'poll' ? 'Poll started. Neighbors who can vote were notified.' : kind === 'challenge' ? (p.going.includes('You') ? 'Challenge posted. You’re signed up.' : 'Challenge posted. Sign up from its page.') : 'Posted');
  };

  const calOptions = cals.slice(1);
  const whoHint = who === 'all' ? `Everyone in ${hood.name} · ${hoodCount(hood)} members`
    : who.startsWith('cal:') ? `Only the ${who.slice(4)} calendar’s ${cals.find(x => x.name === who.slice(4))?.n ?? ''} members`
    : who === 'pick' ? 'Only the neighbors you pick'
    : kind === 'surprise' ? 'Pick the guest of honor. They won’t see the plan, its chat or any reminders.' : 'Everyone except the neighbors you pick';

  return (
    <Screen sheet title={editing ? (kind === 'challenge' ? 'Edit challenge' : 'Edit plan') : src ? 'Copy a plan' : kind === 'beacon' ? 'Light a beacon' : `New ${t.label.toLowerCase()}`} right={<IconButton name="x" label="Cancel" onPress={() => router.back()} />}>
      {src && !editing && <T variant="muted">Copied from “{src.title}”. Pick new dates, then change anything else.</T>}
      {editing && <T variant="muted">Sign-ups, RSVPs and the chat stay as they are.</T>}
      <Field label={spec.titleLabel}>
        <Input value={title} onChangeText={setTitle} placeholder={spec.titlePlaceholder} />
        {suggestions.length > 0 && <Chips>{suggestions.map(x => <Pick key={x} label={x} on={title === x} onPress={() => setTitle(x)} />)}</Chips>}
      </Field>

      {/* ---------- when ---------- */}
      {spec.when.kind === 'datetime' && <>
        {MULTI_DAY.includes(kind) && <Segmented small options={[['one', 'One day'], ['several', 'Several days']]} value={multi} onChange={setMulti} />}
        {multiDay ? (
          <Field label="Dates" hint={range[0] && range[1] ? `${prettyDate(range[0])} to ${prettyDate(range[1])} · ${daysBetween(range[0], range[1])} days, starting at ${formatTime(time)}` : range[0] ? 'Now tap the last day.' : 'Tap the first day, then the last day.'}>
            <DatePicker mode="range" value={range} onChange={setRange} min={today} />
            <TimeField value={time} onChange={setTime} label={spec.when.timeLabel} />
          </Field>
        ) : (
          <Field label="Date" hint={date ? `${prettyDate(date, { weekday: 'long', month: 'long', day: 'numeric' })} at ${formatTime(time)}` : 'Tap a day on the calendar.'}>
            <DatePicker mode="single" value={date} onChange={setDate} min={today} />
            <TimeField value={time} onChange={setTime} label={spec.when.timeLabel} />
          </Field>
        )}
      </>}
      {spec.when.kind === 'now' && (
        <Field label="When">
          <Chips>{(['Now', 'Next hour', 'Tonight'] as const).map(w => <Pick key={w} label={w} on={nowWhen === w} onPress={() => setNowWhen(w)} />)}</Chips>
          <TimeField value={time} onChange={setTime} label="Until about" />
        </Field>
      )}
      {spec.when.kind === 'range' && !fixedDates && (
        <Field label="Dates" hint={range[0] && range[1] ? `${prettyDate(range[0])} to ${prettyDate(range[1])} · ${daysBetween(range[0], range[1])} days` : range[0] ? 'Now tap the last day.' : 'Tap the first day, then the last day.'}>
          <DatePicker mode="range" value={range} onChange={setRange} min={startedOn ?? today} />
        </Field>
      )}
      {fixedDates && <T variant="muted">The dates stay as posted{kind === 'poll' ? ', so votes still count' : ', so meal sign-ups stay put'}. To change them, cancel this and post a new one.</T>}
      {kind === 'poll' && !fixedDates && <>
        <Field label="Kind of poll"><Segmented small options={[['date', 'Pick a date'], ['yesno', 'Yes or no'], ['choice', 'Choices']]} value={pollKind} onChange={setPollKind} /></Field>
        {pollKind === 'date' && (
          <Field label="Dates to vote on" hint={pollDates.length ? pollDates.map(d => prettyDate(d)).join(', ') : 'Tap every date you want neighbors to choose from.'}>
            <DatePicker mode="multi" value={pollDates} onChange={setPollDates} min={today} />
          </Field>
        )}
        {pollKind === 'choice' && <Field label="Choices" hint="One per line."><Input multiline value={list} onChangeText={setList} placeholder={'Burgers\nBrats\nPulled pork'} /></Field>}
        <Field label="Voting closes" hint={closes ? `Closes ${prettyDate(closes, { weekday: 'long', month: 'long', day: 'numeric' })}` : 'Pick the last day to vote.'}>
          <DatePicker mode="single" value={closes} onChange={setCloses} min={today} />
        </Field>
      </>}

      {/* ---------- challenge specifics ---------- */}
      {kind === 'challenge' && <>
        {scoreLocked && <T variant="muted">People have already logged, so the scoring stays as it is. You can still change the name, dates, sign-up deadline, who can see it and the details.</T>}
        {!scoreLocked && <>
        <Field label="Kind of challenge" hint={tpl.blurb}>
          <Chips>{(Object.keys(TEMPLATES) as ChallengeMode[]).map(m => <Pick key={m} label={TEMPLATES[m].label} on={chMode === m} onPress={() => pickMode(m)} />)}</Chips>
        </Field>

        {(chMode === 'time' || chMode === 'distance') && (
          <Field label="What counts" hint="Tap to turn one off, or add your own.">
            <Chips>{[...new Set([...tpl.counts, ...chCounts])].map(a => <Pick key={a} label={a} on={chCounts.includes(a)} onPress={() => setChCounts(x => (x.includes(a) ? x.filter(y => y !== a) : [...x, a]))} />)}</Chips>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Input value={chExtra} onChangeText={setChExtra} placeholder="Add one, like Rowing" onSubmitEditing={addActivity} returnKeyType="done" /></View>
              <Button label="Add" onPress={addActivity} />
            </View>
          </Field>
        )}
        {chMode === 'count' && (
          <Field label="What are people counting?" hint="Plural, like push-ups, books, pages or bags of litter.">
            <Input value={chUnit} onChangeText={setChUnit} placeholder="push-ups" />
          </Field>
        )}
        {chMode === 'distance' && (
          <Field label="Distance in"><Segmented small options={[['miles', 'Miles'], ['km', 'Kilometers']]} value={chUnit === 'km' ? 'km' : 'miles'} onChange={setChUnit} /></Field>
        )}
        {chMode === 'tasks' && (
          <Field label="Tasks and their points" hint="One per line, task = points.">
            <Input multiline value={chTasks} onChangeText={setChTasks} placeholder={'Rake leaves = 3\nMow the lawn = 2\nHelp a neighbor = 5'} />
          </Field>
        )}

        {(chMode === 'time' || chMode === 'distance' || chMode === 'count') && <>
          <Field label="One point block is" hint={`Every full ${chPer || '?'} ${chMode === 'time' ? 'minutes' : chUnit || tpl.unit} earns the points below.`}>
            {chMode === 'time'
              ? <Segmented small options={[['15', '15 min'], ['30', '30 min'], ['60', '1 hour']]} value={(['15', '30', '60'].includes(chPer) ? chPer : '15') as '15' | '30' | '60'} onChange={setChPer} />
              : <Input value={chPer} onChangeText={v => setChPer(v.replace(/[^0-9.]/g, '').slice(0, 5))} keyboardType="decimal-pad" placeholder="1" accessibilityLabel="Block size" />}
          </Field>
          <Field label="Effort levels, points per block" hint="Hard effort usually earns more. Keep one level to score everything the same.">
            {chLevels.map((l, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ flex: 1 }}><Input value={l.name} onChangeText={v => setChLevels(x => x.map((y, k) => (k === i ? { ...y, name: v } : y)))} placeholder="Light" accessibilityLabel={`Effort level ${i + 1} name`} /></View>
                {[1, 2, 3, 4].map(n => <Pick key={n} label={String(n)} on={l.pts === n} onPress={() => setChLevels(x => x.map((y, k) => (k === i ? { ...y, pts: n } : y)))} />)}
                {chLevels.length > 1 && <IconButton name="x" label={`Remove ${l.name || 'level'}`} onPress={() => setChLevels(x => x.filter((_, k) => k !== i))} />}
              </View>
            ))}
            {chLevels.length < 3 && <Button label="Add an effort level" onPress={() => setChLevels(x => [...x, { name: x.length === 1 ? 'Hard' : 'Moderate', pts: Math.min(4, x.length + 1) }])} />}
          </Field>
        </>}
        {chMode === 'checkin' && (
          <Field label="Points per day checked in"><Chips>{[1, 2, 3].map(n => <Pick key={n} label={String(n)} on={chLevels[0]?.pts === n} onPress={() => setChLevels([{ name: 'Done', pts: n }])} />)}</Chips></Field>
        )}
        </>}
        <T variant="muted">{rulesText(draftCh)}. {example}</T>

        <Field label="Sign up by" hint={chSignup ? `Sign-up closes ${prettyDate(chSignup, { weekday: 'long', month: 'long', day: 'numeric' })}.` : range[0] ? `Not set: sign-up closes when it starts, ${prettyDate(range[0])}.` : 'Pick the challenge dates first.'}>
          {range[0] && range[1] && <DatePicker mode="single" value={chSignup} onChange={setChSignup} min={today} max={range[1]} />}
        </Field>

        {!editing && <>
        <Field label="Teams" hint={chTeamsOn === 'none' ? 'Everyone for themselves, plus a total for the whole group.' : chAssign === 'choose' ? 'People pick their team when they sign up, like Boys vs Girls.' : chAssign === 'random' ? 'You split everyone evenly at random with one tap, any time.' : 'You put each person on a team from the leaderboard.'}>
          <Segmented small options={[['none', 'No teams'], ['teams', 'Teams']]} value={chTeamsOn} onChange={setChTeamsOn} />
          {chTeamsOn === 'teams' && <>
            <Input value={chTeamNames} onChangeText={setChTeamNames} placeholder="Boys, Girls" accessibilityLabel="Team names, separated by commas" />
            <Chips>{['Boys, Girls', 'North side, South side', 'Team 1, Team 2, Team 3'].map(x => <Pick key={x} label={x} on={chTeamNames === x} onPress={() => setChTeamNames(x)} />)}</Chips>
            <Segmented small options={[['choose', 'People pick'], ['random', 'Even split'], ['organizer', 'I assign']]} value={chAssign} onChange={setChAssign} />
          </>}
        </Field>
        <Field label="Are you taking part?" hint={chIn === 'in' && chTeamsOn === 'teams' && chAssign === 'choose' ? 'You’ll pick your team and sign up from the challenge page.' : undefined}>
          <Segmented small options={[['in', 'Yes, sign me up'], ['out', 'Just organizing']]} value={chIn} onChange={setChIn} />
        </Field>
        </>}
      </>}

      {/* ---------- meal train specifics ---------- */}
      {kind === 'mealtrain' && <>
        {!editing && <Field label="Meals each day" hint="Most meal trains are dinner only. You can add or remove a meal on any single day after posting.">
          <Chips>{(['Lunch', 'Dinner'] as const).map(m => <Pick key={m} label={m} on={meals.includes(m)} onPress={() => setMeals(x => (x.includes(m) ? (x.length > 1 ? x.filter(y => y !== m) : x) : [...x, m]))} />)}</Chips>
        </Field>}
        <Field label="Who is it for?"><Input value={mtFor} onChangeText={setMtFor} placeholder="The Hendersons" /></Field>
        <Field label="Their address" hint="Only people who sign up for a meal will see the address."><Input value={mtAddr} onChangeText={setMtAddr} placeholder="118 Maple St" /></Field>
        <Field label="Drop-off instructions"><Input value={mtDrop} onChangeText={setMtDrop} placeholder="Cooler on the porch. Text, don’t knock." /></Field>
        <Field label="Allergies and preferences"><Input multiline value={list} onChangeText={setList} placeholder="No nuts, kids love pasta, disposable containers are best" /></Field>
      </>}

      {/* ---------- where ---------- */}
      {spec.place && (
        <Field label={spec.place.label}>
          <Chips>
            {picks.map(pl => <Pick key={pl} label={pl} on={place === pl} onPress={() => { setPlace(pl); setPlaceText(''); }} />)}
            {!!picks.length && <Pick label="Other" on={place === 'Other'} onPress={() => setPlace('Other')} />}
          </Chips>
          {place === 'Other' && <Input value={placeText} onChangeText={setPlaceText} placeholder={spec.place.placeholder} autoFocus={!!picks.length && !placeText} />}
          <Input value={addr} onChangeText={v => { setAddr(v); setAddrState('idle'); }} placeholder="Street address, for directions (optional)" onEndEditing={verifyAddress}
            textContentType="fullStreetAddress" accessibilityLabel="Street address" />
          {addrState === 'checking' && <T variant="muted">Checking the address…</T>}
          {addrState === 'ok' && <T variant="muted">✓ Found it. Guests can tap the address for directions.</T>}
          {addrState === 'none' && <T variant="muted">Couldn’t find that address. Check the spelling, or post it as typed.</T>}
          {addrState === 'idle' && !!addr.trim() && <Pressable onPress={verifyAddress} accessibilityRole="button"><Text style={{ fontFamily: fonts.bodySemi, color: c.pine }}>Check address</Text></Pressable>}
        </Field>
      )}
      {spec.route && <Field label={spec.route.label}><Input value={route} onChangeText={setRoute} placeholder={spec.route.placeholder} /></Field>}
      {spec.list && !editing && <Field label={spec.list.label} hint={spec.list.hint}><Input multiline value={list} onChangeText={setList} placeholder={spec.list.placeholder} /></Field>}

      {/* ---------- who: one choice, so nothing below quietly overrides it ---------- */}
      <Field label={kind === 'poll' ? 'Who can vote' : 'Who’s invited'} hint={whoHint}>
        <Chips>
          <Pick label={`Everyone in ${hood.name}`} on={who === 'all'} onPress={() => { setWho('all'); setPicked([]); }} />
          {calOptions.map(cl => <Pick key={cl.name} label={`${cl.name} calendar`} on={who === `cal:${cl.name}`} onPress={() => { setWho(`cal:${cl.name}`); setPicked([]); }} />)}
          <Pick label="Pick people" on={who === 'pick'} onPress={() => { setWho('pick'); setPicked([]); }} />
          <Pick label="Everyone except…" on={who === 'except'} onPress={() => { setWho('except'); setPicked([]); }} />
        </Chips>
        {(who === 'pick' || who === 'except') && <PeoplePicker value={picked} onChange={setPicked} except={who === 'except'} />}
      </Field>

      {iAmHost && kind !== 'beacon' && (
        <Field label="Who can edit" hint={editorsOn === 'me' ? 'Only you can change or cancel it.' : 'They can change the details, dates and who’s invited. Only you can cancel it or change who can edit.'}>
          <Segmented small options={[['me', 'Just me'], ['others', 'Me and people I pick']]} value={editorsOn} onChange={setEditorsOn} />
          {editorsOn === 'others' && <PeoplePicker value={editors} onChange={setEditors} summaryLabel="Can edit: " />}
        </Field>
      )}

      {spec.detailsPlaceholder && <Field label="Details (optional)"><Input multiline value={details} onChangeText={setDetails} placeholder={spec.detailsPlaceholder} /></Field>}

      {!!error && <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.bodySemi, color: c.ember }}>{error}</Text>}
      <Button kind={kind === 'beacon' ? 'ember' : 'primary'} icon={kind === 'beacon' ? 'flame' : kind === 'poll' ? 'poll' : undefined}
        label={editing ? 'Save changes' : kind === 'beacon' ? 'Light it' : kind === 'poll' ? 'Start poll' : kind === 'help' ? `Ask ${hood.name}` : `Post to ${who === 'all' ? hood.name : who.startsWith('cal:') ? who.slice(4) : 'your list'}`} onPress={post} />
      <Button label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return <Section title={label}>{children}{hint ? <T variant="muted">{hint}</T> : null}</Section>;
}
function Chips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{children}</View>;
}
function Input(props: ComponentProps<typeof TextInput>) {
  const { c } = useTheme();
  // Named for VoiceOver by its placeholder unless given a label (the placeholder vanishes once there's text).
  return <TextInput placeholderTextColor={c.muted} accessibilityLabel={props.placeholder} {...props}
    style={[styles.input, props.multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 11 }, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />;
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 46, fontFamily: fonts.body, fontSize: 15 },
});

export default function GuardedCreatePlan() {
  return useHoodPaused() ? <PausedScreen /> : <CreatePlan />;
}
