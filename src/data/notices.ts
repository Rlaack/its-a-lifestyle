import { addActivity, dropActivityFor, isQuiet } from './activity';
import { getState, whenText } from './store';
import type { PlanOp } from './planOps';
import type { Message, Plan } from './types';

// Turns what just arrived (already decrypted, on this phone) into a notification that says what
// happened and opens the right screen: "Alex: Who’s bringing chairs?", "Sam is going to Potluck".

const TYPE_NAME: Record<Plan['type'], string> = {
  gathering: 'get-together', beacon: 'beacon', potluck: 'potluck', paddle: 'paddle', walk: 'walk', help: 'request for help',
  mealtrain: 'meal train', games: 'game night', surprise: 'surprise', poll: 'poll', challenge: 'challenge',
};

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** "in Maple Ridge", only for people in more than one neighborhood. */
const inHood = (hoodId?: string | null) => {
  const st = getState();
  if (!hoodId || st.hoodList.length < 2) return '';
  const n = st.hoodList.find(h => h.id === hoodId)?.name;
  return n ? ` in ${n}` : '';
};

export function previewOf(m: Message): string {
  if (!('t' in m) && !('type' in m)) return 'New message';
  const x = m as { t?: string; type?: string; name?: string };
  if (x.type === 'photo') return x.t ? `📷 ${x.t}` : '📷 Photo';
  if (x.type === 'voice') return '🎤 Voice message';
  if (x.type === 'file') return `📎 ${x.name ?? 'File'}`;
  if (x.type === 'loc') return '📍 Shared a location';
  return x.t ? clip(x.t) : 'New message';
}

/** A message from someone else. `direct`: a 1:1 chat, titled with their name. */
export function noteMessage(o: { chatId: string; chatName: string; who: string; msg: Message; hood?: string | null; direct: boolean }) {
  if (o.msg.f === 'sys' || o.msg.f === 'key' || o.msg.f === 'device' || o.msg.f === 'You') return;
  const text = previewOf(o.msg);
  addActivity({
    kind: 'message', route: `/chat/${o.chatId}`, group: `chat:${o.chatId}`, ...(o.hood ? { hood: o.hood } : {}),
    title: o.direct ? o.who : `${o.chatName}${inHood(o.hood)}`,
    body: o.direct ? text : `${o.who}: ${text}`,
  });
}

/** Someone reacted to a message. Only reactions to my own messages are worth a notification. */
export function noteReaction(o: { chatId: string; who: string; e: string; mid: string; on: boolean; hood?: string | null }) {
  if (!o.on) return;
  const st = getState();
  const chat = st.chats.find(c => c.id === o.chatId) ?? (o.hood ? st.stash[o.hood]?.chats.find(c => c.id === o.chatId) : undefined);
  const m = chat?.msgs.find(x => 'mid' in x && x.mid === o.mid);
  if (!chat || !m || m.f !== 'You') return;
  addActivity({
    kind: 'reaction', route: `/chat/${o.chatId}`, ...(o.hood ? { hood: o.hood } : {}),
    title: chat.name, body: `${o.who} reacted ${o.e} to “${clip(previewOf(m), 60)}”`,
  });
}

const mine = (p: Plan) => p.host === 'You' || (p.editors ?? []).includes('You');
/** In it some way: hosting, editing, going, maybe, bringing something or signed up for a meal. */
const involved = (p: Plan) => mine(p) || p.going.includes('You') || !!p.maybe?.includes('You') || p.rsvp === 'going' || p.rsvp === 'maybe'
  || !!p.lists?.some(l => l.items.some(i => i.by === 'You')) || !!p.days?.some(d => d.slots.some(s => s.by === 'You'))
  || !!p.options?.some(o => o.v.includes('You'));

/** A plan posted by someone else that this phone hasn't seen before. */
export function noteNewPlan(hoodId: string, p: Plan) {
  if (p.host === 'You' || isQuiet(hoodId)) return;
  addActivity({
    kind: 'plan', route: `/event/${p.id}`, hood: hoodId,
    title: p.live ? `${p.host} lit a beacon${inHood(hoodId)}` : `New ${TYPE_NAME[p.type] ?? 'plan'} from ${p.host}${inHood(hoodId)}`,
    body: p.type === 'poll' ? `${p.title}${p.closes ? ` · ${p.closes}` : ''}` : `${p.title} · ${whenText(p)}${p.where && !p.live ? ` · ${p.where}` : ''}`,
  });
}

const dayKey = (p: Plan) => `${p.y ?? ''}-${p.m}-${p.d}`;
/** What changed that people in the plan need to know: the day, the time, the place or the name. */
function whatChanged(a: Plan, b: Plan): string | null {
  const parts: string[] = [];
  const when = a.challenge && b.challenge
    ? a.challenge.start !== b.challenge.start || a.challenge.end !== b.challenge.end
    : dayKey(a) !== dayKey(b) || a.time !== b.time || (a.end ?? '') !== (b.end ?? '');
  if (when) parts.push(`Now ${whenText(b)}`);
  if ((a.where ?? '') !== (b.where ?? '') && b.where) parts.push(`${when ? 'at' : 'Now at'} ${b.where}`);
  if (a.title !== b.title) parts.push(`Was “${clip(a.title, 40)}”`);
  if (!parts.length && (a.note ?? '') !== (b.note ?? '') && b.note) parts.push('The host updated the details');
  return parts.length ? parts.join(' · ') : null;
}

/** A change from a neighbor to a plan in one of my neighborhoods. `before`/`after`: the plan around the change. */
export function notePlanOp(hoodId: string, op: PlanOp, who: string, before: Plan | undefined, after: Plan | undefined) {
  if (who === 'You') return;
  if (op.t === 'plan') {
    if (!before && after) return noteNewPlan(hoodId, after);
    if (!before || !after || !involved(before)) return;
    const what = whatChanged(before, after);
    if (what) addActivity({ kind: 'change', route: `/event/${after.id}`, hood: hoodId, group: `change:${after.id}`, title: `Changed: ${after.title}`, body: `${what} (by ${who})` });
    return;
  }
  if (op.t === 'cancel') {
    if (!before || after || !involved(before)) return;
    dropActivityFor(`/event/${before.id}`);
    addActivity({ kind: 'cancel', route: '/', hood: hoodId, title: `Cancelled: ${before.title}`, body: `${who} cancelled ${before.live ? 'this beacon' : `the ${TYPE_NAME[before.type] ?? 'plan'}`}${before.live ? '' : ` for ${whenText(before)}`}.` });
    return;
  }
  if (!after || !mine(after)) return;
  const base = { route: `/event/${after.id}`, hood: hoodId, title: after.title };
  const resp = (body: string) => addActivity({ kind: 'response', group: `resp:${after.id}`, ...base, body });
  const help = after.type === 'help';
  // Only real news: the same change seen again (a repeat delivery) says nothing.
  switch (op.t) {
    case 'rsvp':
      if (op.v === 'going' && !before?.going.includes(who)) resp(help ? `${who} will help` : `${who} is going`);
      else if (op.v === 'maybe' && !before?.maybe?.includes(who)) resp(`${who} might come`);
      else if (op.v === 'no' && before?.going.includes(who)) resp(`${who} can’t make it anymore`);
      return;
    case 'claim': {
      const item = after.lists?.[op.li]?.items[op.ii];
      if (op.on && item?.by === who && before?.lists?.[op.li]?.items[op.ii]?.by !== who) resp(help ? `${who} will help with ${item.name}` : `${who} is bringing ${item.name}`);
      return;
    }
    case 'addItem':
      if (op.mine && !before?.lists?.some(l => l.items.some(i => i.name === op.name && i.by === who))) resp(`${who} is bringing ${op.name}`);
      return;
    case 'meal': {
      const day = after.days?.[op.di], slot = day?.slots[op.si];
      if (op.on && day && slot?.by === who && before?.days?.[op.di]?.slots[op.si]?.by !== who) resp(`${who} is bringing ${slot.meal.toLowerCase()} on ${day.d}`);
      return;
    }
    case 'join': if (op.on && !before?.going.includes(who)) resp(`${who} joined${op.team ? ` (team ${op.team})` : ''}`); return;
    case 'vote': if (op.on && !before?.options?.[op.i]?.v.includes(who)) resp(`${who} voted`); return;
    case 'react': if (op.on && !before?.r?.[op.e]?.includes(who)) addActivity({ kind: 'reaction', ...base, body: `${who} reacted ${op.e}` }); return;
    default: return;
  }
}
