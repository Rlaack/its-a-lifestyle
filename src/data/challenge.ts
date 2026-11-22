import type { Challenge, ChallengeEntry, ChallengeLevel, ChallengeMode, ChallengeTask, Plan } from './types';

// Scoring for friendly, honor-system challenges.
//
// Points come from totals, not single entries, so logging in small pieces never loses credit:
// two 10-minute walks count the same as one 20-minute walk. For time, distance and count, each
// person's total at each effort level is split into blocks of `per`, and each full block earns that
// level's points. Example: 15-minute blocks, Light 1 / Hard 2. 50 min light + 45 min hard
// = floor(50/15)·1 + floor(45/15)·2 = 3 + 6 = 9 points.
// Tasks earn their own points each time. Check-ins earn the points once per day.

export type Template = {
  mode: ChallengeMode; label: string; blurb: string; unitLabel: string;
  per: number; unit?: string; levels: ChallengeLevel[]; counts: string[]; tasks?: ChallengeTask[];
};

export const EXERCISE = ['Walking', 'Running', 'Biking', 'Swimming', 'Paddling', 'Strength', 'HIIT', 'Yoga or stretching', 'Yard work and chores', 'Anything active'];

export const TEMPLATES: Record<ChallengeMode, Template> = {
  time: { mode: 'time', label: 'Minutes of activity', blurb: 'Exercise, chores, practice: points for time spent', unitLabel: 'minutes',
    per: 15, levels: [{ name: 'Light', pts: 1 }, { name: 'Hard', pts: 2 }], counts: EXERCISE },
  distance: { mode: 'distance', label: 'Distance', blurb: 'Miles walked, run, biked or paddled', unitLabel: 'miles',
    per: 1, unit: 'miles', levels: [{ name: 'Any pace', pts: 1 }], counts: ['Walking', 'Running', 'Biking', 'Swimming', 'Paddling'] },
  count: { mode: 'count', label: 'Count something', blurb: 'Push-ups, books read, bags of litter picked up', unitLabel: 'items',
    per: 1, unit: 'push-ups', levels: [{ name: 'Standard', pts: 1 }], counts: ['Push-ups'] },
  tasks: { mode: 'tasks', label: 'Tasks and chores', blurb: 'A list of tasks, each worth its own points', unitLabel: 'tasks',
    per: 1, levels: [{ name: 'Done', pts: 1 }], counts: [],
    tasks: [{ name: 'Rake leaves', pts: 3 }, { name: 'Mow the lawn', pts: 2 }, { name: 'Help a neighbor', pts: 5 }] },
  checkin: { mode: 'checkin', label: 'Daily check-in', blurb: 'Did it today? No soda, 10k steps, read 20 minutes', unitLabel: 'days',
    per: 1, levels: [{ name: 'Done', pts: 1 }], counts: ['Did it today'] },
};

export const unitOf = (ch: Challenge) =>
  ch.mode === 'time' ? 'min' : ch.mode === 'distance' ? ch.unit ?? 'miles' : ch.mode === 'count' ? ch.unit ?? 'items' : ch.mode === 'tasks' ? 'tasks' : 'days';

const levelPts = (ch: Challenge, level: number) => ch.levels[level]?.pts ?? ch.levels[0]?.pts ?? 1;
const taskPts = (ch: Challenge, what: string) => ch.tasks?.find(t => t.name === what)?.pts ?? 0;

/** Total points for one person's entries. */
export function scoreEntries(entries: ChallengeEntry[], ch: Challenge): number {
  if (ch.mode === 'tasks') return entries.reduce((a, e) => a + taskPts(ch, e.what) * Math.max(0, Math.round(e.amount)), 0);
  if (ch.mode === 'checkin') return new Set(entries.map(e => e.day)).size * levelPts(ch, 0);
  const byLevel = new Map<number, number>();
  for (const e of entries) byLevel.set(e.level, (byLevel.get(e.level) ?? 0) + e.amount);
  let pts = 0;
  for (const [level, total] of byLevel) pts += Math.floor(total / ch.per + 1e-9) * levelPts(ch, level);
  return pts;
}

/** How many points adding (or replacing) one entry would change this person's score by. */
export function pointsDelta(ch: Challenge, who: string, entry: Omit<ChallengeEntry, 'id' | 'who'>, replacingId?: string) {
  const mine = ch.log.filter(e => e.who === who);
  const others = mine.filter(e => e.id !== replacingId);
  return scoreEntries([...others, { ...entry, id: '_', who }], ch) - scoreEntries(mine, ch);
}

export function rulesText(ch: Challenge): string {
  const pts = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;
  const block = (u: string) => (ch.per === 1 ? `each ${u.replace(/s$/, '')}` : `every ${ch.per} ${u}`);
  switch (ch.mode) {
    case 'time': case 'distance': case 'count': {
      const u = unitOf(ch) === 'min' ? 'minutes' : unitOf(ch);
      return ch.levels.length === 1
        ? `${pts(ch.levels[0].pts)} for ${block(u)}`
        : `${ch.levels.map(l => `${pts(l.pts)} per ${ch.per === 1 ? u.replace(/s$/, '') : `${ch.per} ${u}`} of ${l.name.toLowerCase()} effort`).join(', ')}`;
    }
    case 'tasks': return (ch.tasks ?? []).map(t => `${t.name}: ${pts(t.pts)}`).join(' · ');
    case 'checkin': return `${pts(ch.levels[0]?.pts ?? 1)} for each day you check in`;
  }
}

export type Standing = { who: string; pts: number; amount: number; team?: string };

/** Leaderboard for people who signed up, highest first. Ties share a rank. */
export function standings(p: Plan): (Standing & { rank: number })[] {
  const ch = p.challenge;
  if (!ch) return [];
  const rows = p.going.map(who => {
    const mine = ch.log.filter(e => e.who === who);
    return { who, pts: scoreEntries(mine, ch), amount: mine.reduce((a, e) => a + e.amount, 0), team: ch.teams?.of[who] };
  }).sort((a, b) => b.pts - a.pts || b.amount - a.amount || a.who.localeCompare(b.who));
  return rows.map((r, i) => ({ ...r, rank: i > 0 && rows[i - 1].pts === r.pts ? rows.findIndex(x => x.pts === r.pts) + 1 : i + 1 }));
}

export type TeamStanding = { name: string; pts: number; members: number; avg: number };
/** Team totals and per-person averages (fair when teams aren't the same size). */
export function teamStandings(p: Plan): TeamStanding[] {
  const ch = p.challenge;
  if (!ch?.teams) return [];
  const rows = standings(p);
  return ch.teams.names.map(name => {
    const mine = rows.filter(r => r.team === name);
    const pts = mine.reduce((a, r) => a + r.pts, 0);
    return { name, pts, members: mine.length, avg: mine.length ? Math.round((pts / mine.length) * 10) / 10 : 0 };
  }).sort((a, b) => b.pts - a.pts);
}

export const groupPoints = (p: Plan) => standings(p).reduce((a, r) => a + r.pts, 0);

/** Random, even split of everyone signed up who has no team yet. */
export function splitTeams(people: string[], names: string[], current: Record<string, string>, rand = Math.random): Record<string, string> {
  const of = { ...current };
  const size = (n: string) => Object.values(of).filter(t => t === n).length;
  const unassigned = people.filter(p => !of[p]);
  for (let i = unassigned.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [unassigned[i], unassigned[j]] = [unassigned[j], unassigned[i]]; }
  for (const person of unassigned) {
    const smallest = [...names].sort((a, b) => size(a) - size(b) || names.indexOf(a) - names.indexOf(b))[0];
    of[person] = smallest;
  }
  return of;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => iso(new Date());
export const addDaysISO = (s: string, n: number) => { const d = new Date(`${s}T12:00`); d.setDate(d.getDate() + n); return iso(d); };

/** Logging stays open 3 days after the end, so people can catch up on the last few days. */
export const GRACE_DAYS = 3;
export type Phase = 'upcoming' | 'on' | 'grace' | 'over';
export const phaseOf = (ch: Challenge, today = todayISO()): Phase =>
  today < ch.start ? 'upcoming' : today <= ch.end ? 'on' : today <= addDaysISO(ch.end, GRACE_DAYS) ? 'grace' : 'over';
export const signupOpen = (ch: Challenge, today = todayISO()) => today <= ch.signupBy && today <= ch.end;
export const canLog = (ch: Challenge, today = todayISO()) => { const ph = phaseOf(ch, today); return ph === 'on' || ph === 'grace'; };
/** Last day you can log for right now: today, or the final day once the challenge is over. */
export const lastLoggableDay = (ch: Challenge, today = todayISO()) => (today < ch.end ? today : ch.end);
export const daysLeft = (ch: Challenge, today = todayISO()) =>
  Math.round((new Date(`${ch.end}T12:00`).getTime() - new Date(`${today}T12:00`).getTime()) / 864e5) + 1;
export const prettyISO = (s: string) => new Date(`${s}T12:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
