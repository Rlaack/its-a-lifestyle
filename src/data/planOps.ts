import type { ChallengeEntry, Plan } from './types';

// Every change anyone can make to a shared plan, as a small "op". The same op is applied on every
// phone: by its author (as "You") and, after it arrives encrypted, by everyone else (as the author's
// name). Ops carry the end state ("on: true"), not a toggle, so applying one twice changes nothing.

export type PlanOp =
  | { t: 'plan'; plan: Plan }                                            // a new plan (from its host)
  | { t: 'cancel'; id: string }                                          // host removed it
  | { t: 'rsvp'; id: string; v: 'going' | 'maybe' | 'no' | null }
  | { t: 'claim'; id: string; li: number; ii: number; on: boolean }      // sign-up list item
  | { t: 'addItem'; id: string; name: string; mine: boolean }
  | { t: 'meal'; id: string; di: number; si: number; on: boolean }
  | { t: 'mealNote'; id: string; di: number; si: number; what: string }
  | { t: 'addMeal'; id: string; di: number; meal: 'Lunch' | 'Dinner' }
  | { t: 'rmMeal'; id: string; di: number; si: number }
  | { t: 'react'; id: string; e: string; on: boolean }
  | { t: 'vote'; id: string; i: number; on: boolean }
  | { t: 'join'; id: string; on: boolean; team?: string }               // challenge sign-up
  | { t: 'teams'; id: string; of: Record<string, string> }              // organizer's team assignments
  | { t: 'log'; id: string; entry: Omit<ChallengeEntry, 'who'> }        // add or replace (same id) an entry
  | { t: 'unlog'; id: string; entryId: string };

export const opPlanId = (op: PlanOp) => (op.t === 'plan' ? op.plan.id : op.id);

const without = (l: string[] = [], who: string) => l.filter(n => n !== who);

/** Applies one op to a plan, as `who` ("You" for my own ops). Returns the plan unchanged if it doesn't apply. */
export function applyOp(p: Plan, op: PlanOp, who: string, opts: { authorIsHost?: boolean } = {}): Plan {
  switch (op.t) {
    case 'plan': return p;
    case 'cancel': return p;
    case 'rsvp': {
      const going = without(p.going, who), maybe = without(p.maybe, who);
      if (op.v === 'going') going.unshift(who);
      if (op.v === 'maybe') maybe.unshift(who);
      return { ...p, going, maybe, ...(who === 'You' ? { rsvp: op.v } : {}) };
    }
    case 'claim':
      return { ...p, lists: p.lists?.map((l, a) => (a !== op.li ? l : {
        ...l, items: l.items.map((it, b) => (b !== op.ii ? it : op.on ? (it.by ? it : { ...it, by: who }) : it.by === who ? { ...it, by: null } : it)),
      })) };
    case 'addItem':
      if (!p.lists?.length || p.lists[p.lists.length - 1].items.length >= 200) return p;
      if (p.lists[p.lists.length - 1].items.some(it => it.name === op.name.slice(0, 80))) return p; // already there (replayed)
      return { ...p, lists: p.lists.map((l, i) => (i === p.lists!.length - 1 ? { ...l, items: [...l.items, { name: op.name.slice(0, 80), by: op.mine ? who : null }] } : l)) };
    case 'meal':
      return { ...p, days: p.days?.map((d, a) => (a !== op.di ? d : {
        ...d, slots: d.slots.map((s, b) => (b !== op.si ? s : op.on ? (s.by ? s : { ...s, by: who }) : s.by === who ? { ...s, by: null, what: '' } : s)),
      })) };
    case 'mealNote':
      return { ...p, days: p.days?.map((d, a) => (a !== op.di ? d : { ...d, slots: d.slots.map((s, b) => (b !== op.si || s.by !== who ? s : { ...s, what: op.what.slice(0, 120) })) })) };
    case 'addMeal':
      if (!opts.authorIsHost) return p;
      return { ...p, days: p.days?.map((d, a) => (a !== op.di || d.slots.some(s => s.meal === op.meal) ? d : { ...d, slots: [...d.slots, { meal: op.meal, by: null }].sort((x, y) => (x.meal === 'Lunch' ? -1 : 1) - (y.meal === 'Lunch' ? -1 : 1)) })) };
    case 'rmMeal':
      if (!opts.authorIsHost) return p;
      return { ...p, days: p.days?.map((d, a) => (a !== op.di ? d : { ...d, slots: d.slots.filter((s, b) => b !== op.si || !!s.by) })) };
    case 'react': {
      const r = { ...(p.r ?? {}) };
      r[op.e] = op.on ? [...without(r[op.e], who), who] : without(r[op.e], who);
      return { ...p, r };
    }
    case 'vote': {
      if (!p.options?.[op.i]) return p;
      return { ...p, options: p.options.map((o, k) => {
        let v = p.multi ? o.v : without(o.v, who);
        if (k === op.i) v = op.on ? [...without(v, who), who] : without(v, who);
        return { ...o, v };
      }) };
    }
    case 'join': {
      const ch = p.challenge;
      if (!ch) return p;
      if (!op.on) {
        const of = { ...(ch.teams?.of ?? {}) }; delete of[who];
        return { ...p, going: without(p.going, who), ...(who === 'You' ? { rsvp: null } : {}), challenge: { ...ch, teams: ch.teams && { ...ch.teams, of } } };
      }
      const team = op.team && ch.teams?.names.includes(op.team) ? op.team : undefined;
      return {
        ...p, going: [...without(p.going, who), who], ...(who === 'You' ? { rsvp: 'going' as const } : {}),
        challenge: { ...ch, teams: ch.teams && (team ? { ...ch.teams, of: { ...ch.teams.of, [who]: team } } : ch.teams) },
      };
    }
    case 'teams': {
      if (!opts.authorIsHost || !p.challenge?.teams) return p;
      const names = p.challenge.teams.names;
      const of = Object.fromEntries(Object.entries(op.of).filter(([, t]) => names.includes(t)));
      return { ...p, challenge: { ...p.challenge, teams: { ...p.challenge.teams, of } } };
    }
    case 'log': {
      const ch = p.challenge;
      if (!ch) return p;
      const entry: ChallengeEntry = { ...op.entry, who };
      const mine = ch.log.find(x => x.id === entry.id);
      if (mine && mine.who !== who) return p; // nobody edits someone else's entry
      return { ...p, challenge: { ...ch, log: mine ? ch.log.map(x => (x.id === entry.id ? entry : x)) : [...ch.log, entry] } };
    }
    case 'unlog':
      return !p.challenge ? p : { ...p, challenge: { ...p.challenge, log: p.challenge.log.filter(e => !(e.id === op.entryId && e.who === who)) } };
  }
}

/* ---------- names ---------- */
// On my phone I'm "You"; on everyone else's I'm my chosen name. Plans travel with real names and
// are switched to "You" on arrival. Only whole strings in people fields are swapped.

type Swap = (n: string) => string;
function mapPeople(p: Plan, f: Swap): Plan {
  const m = (l?: string[]) => l?.map(f);
  return {
    ...p, host: f(p.host), editors: m(p.editors), going: p.going.map(f), maybe: m(p.maybe), invited: m(p.invited), excluded: m(p.excluded),
    r: p.r && Object.fromEntries(Object.entries(p.r).map(([e, l]) => [e, l.map(f)])),
    lists: p.lists?.map(l => ({ ...l, items: l.items.map(it => ({ ...it, by: it.by && f(it.by) })) })),
    days: p.days?.map(d => ({ ...d, slots: d.slots.map(s => ({ ...s, by: s.by && f(s.by) })) })),
    options: p.options?.map(o => ({ ...o, v: o.v.map(f) })),
    challenge: p.challenge && {
      ...p.challenge, log: p.challenge.log.map(e => ({ ...e, who: f(e.who) })),
      teams: p.challenge.teams && { ...p.challenge.teams, of: Object.fromEntries(Object.entries(p.challenge.teams.of).map(([k, v]) => [f(k), v])) },
    },
  };
}

/** For sending: "You" becomes my name, and my own private choices (reminders, calendar copy, my RSVP) stay behind. */
export function planForSending(p: Plan, myName: string): Plan {
  const out = mapPeople(p, n => (n === 'You' ? myName : n));
  // "Your place, Elk Court" is only true on my phone. Neighbors see whose place it is, not the street:
  // the exact address goes out only if I added one on purpose.
  const where = /^Your place\b/.test(out.where) ? `${myName}’s place` : out.where;
  const { bu: _local, ...sent } = { ...out, where, rsvp: null, remind: [], calCopy: null };
  return sent;
}
/** For receiving: my name becomes "You", and my RSVP is worked out from the lists. */
export function planFromSender(p: Plan, myName: string): Plan {
  const out = mapPeople(p, n => (n === myName ? 'You' : n));
  return { ...out, rsvp: out.going.includes('You') ? 'going' : out.maybe?.includes('You') ? 'maybe' : null, remind: [], calCopy: null };
}
