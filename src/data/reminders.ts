import * as Notifications from 'expo-notifications';
import { prefOn, subscribeActivity } from './activity';
import { getState, planDate, subscribeStore, whenText } from './store';
import type { Plan } from './types';

// "Remind me" on a plan: scheduled here as phone notifications, which fire even when the app is closed.
// Rescheduled whenever plans change (a host moves the time, you stop going, a plan is cancelled).

const parseTime = (t: string, fallback: [number, number]): [number, number] => {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return fallback;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return [h, Number(m[2])];
};
const at = (day: Date, h: number, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d; };
const addDays = (day: Date, n: number) => { const d = new Date(day); d.setDate(d.getDate() + n); return d; };
const isoDay = (s: string) => new Date(`${s}T12:00`);

type Want = { id: string; date: Date; title: string; body: string; route: string; hood: string };

/** The reminders one plan asks for, as dates. */
function remindersFor(p: Plan, hood: string): Want[] {
  const out: Want[] = [];
  const route = `/event/${p.id}`;
  const add = (key: string, date: Date, title: string, body: string) => out.push({ id: `rem:${hood}:${p.id}:${key}:${date.getTime()}`, date, title, body, route, hood });
  const start = planDate(p);
  const [h, m] = parseTime(p.time ?? '', [18, 0]);
  const begins = at(start, h, m);
  const where = p.where ? ` · ${p.where}` : '';
  for (const o of p.remind ?? []) {
    if (o === 'Day before') add(o, at(addDays(start, -1), 18), `Tomorrow: ${p.title}`, `${whenText(p)}${where}`);
    else if (o === 'Morning of') add(o, at(start, 8), `Today: ${p.title}`, `${whenText(p)}${where}`);
    else if (o === '1 hour before') add(o, new Date(begins.getTime() - 3600_000), `In an hour: ${p.title}`, `${p.time}${where}`);
    else if (o === 'Before voting closes') add(o, at(start, 9), `Voting closes today: ${p.title}`, 'Tap to vote before it closes.');
    else if (o === 'Last day' && p.challenge) add(o, at(isoDay(p.challenge.end), 9), `Last day: ${p.title}`, 'Log today’s points before the challenge ends.');
    else if (o === 'Evening nudge to log' && p.challenge) {
      for (let d = isoDay(p.challenge.start), i = 0; d <= isoDay(p.challenge.end) && i < 120; d = addDays(d, 1), i++)
        add(`${o}:${i}`, at(d, 19), p.title, 'Did you do anything today? Log it.');
    } else if ((o === 'Day before my meal' || o === 'Morning of my meal') && p.days) {
      p.days.forEach((day, di) => day.slots.forEach((s, si) => {
        if (s.by !== 'You') return;
        const d = addDays(start, di), what = `${s.meal} for ${p.for ?? 'a neighbor'}`;
        if (o === 'Day before my meal') add(`${o}:${di}:${si}`, at(addDays(d, -1), 18), `Tomorrow: you’re bringing ${s.meal.toLowerCase()}`, what);
        else add(`${o}:${di}:${si}`, at(d, 8), `Today: you’re bringing ${s.meal.toLowerCase()}`, what);
      }));
    }
  }
  return out;
}

/** Everything that should be scheduled right now, soonest first. iOS keeps at most 64; we use 50. */
function wanted(): Want[] {
  if (!prefOn('reminders')) return [];
  const st = getState(), now = Date.now();
  const all: Want[] = [];
  const hoods: [string, Plan[]][] = [[st.cur, st.plans], ...Object.entries(st.stash).filter(([k]) => k !== st.cur).map(([k, v]) => [k, v.plans] as [string, Plan[]])];
  for (const [hood, plans] of hoods) for (const p of plans) {
    if (!p.remind?.length || p.live || p.rsvp === 'no') continue;
    all.push(...remindersFor(p, hood));
  }
  return all.filter(w => w.date.getTime() > now + 30_000).sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 50);
}

let busy = false, again = false;
async function reschedule() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    const want = wanted();
    if (want.length && !(await Notifications.getPermissionsAsync()).granted) return;
    const have = (await Notifications.getAllScheduledNotificationsAsync()).filter(n => n.identifier.startsWith('rem:'));
    const wantIds = new Set(want.map(w => w.id)), haveIds = new Set(have.map(n => n.identifier));
    for (const n of have) if (!wantIds.has(n.identifier)) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    for (const w of want) {
      if (haveIds.has(w.id)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: w.id,
        content: { title: w.title, body: w.body, sound: 'default', data: { route: w.route, hood: w.hood, kind: 'reminder' }, threadIdentifier: 'reminder' },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: w.date },
      });
    }
  } catch (e) {
    if (__DEV__) console.log('[reminders] could not schedule', String(e));
  } finally {
    busy = false;
    if (again) { again = false; schedule(); }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; reschedule(); }, 1500); };

let started = false;
/** Keeps scheduled reminders in step with the plans. Call once at start-up. */
export function startReminders() {
  if (started) return;
  started = true;
  let plans = getState().plans, stash = getState().stash;
  subscribeStore(() => { const st = getState(); if (st.plans !== plans || st.stash !== stash) { plans = st.plans; stash = st.stash; schedule(); } });
  subscribeActivity(schedule); // the Reminders setting
  schedule();
}
