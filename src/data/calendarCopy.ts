import { Linking, Platform } from 'react-native';
import { planDate, whenText } from './store';
import type { Plan } from './types';

// What gets copied to a phone or Google calendar. Only safe details leave the app:
// a surprise becomes "Private event", a meal train copies only your own drop-off and never the address.
export type CalCopy = { title: string; when: string; where: string; start: Date; end: Date; mine: string[] };

const parseTime = (t: string, fallback: [number, number]): [number, number] => {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return fallback;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return [h, Number(m[2])];
};

export function calCopyOf(p: Plan): CalCopy {
  if (p.type === 'mealtrain' && p.days) {
    const mine: { label: string; start: Date }[] = [];
    p.days.forEach((d, i) => d.slots.forEach(s => {
      if (s.by !== 'You') return;
      const day = new Date(p.y ?? 2026, p.m - 1, p.d + i);
      const [h, mm] = s.meal === 'Lunch' ? [12, 0] : [17, 30];
      day.setHours(h, mm, 0, 0);
      mine.push({ label: `${s.meal} on ${d.d}`, start: day });
    }));
    const start = mine[0]?.start ?? planDate(p);
    return { title: `Meal drop-off for ${p.for ?? 'a neighbor'}`, when: mine.map(x => x.label).join(' · '), where: 'Address stays in the app', start, end: new Date(start.getTime() + 30 * 60000), mine: mine.map(x => x.label) };
  }
  const start = planDate(p);
  const [h, mm] = parseTime(p.time, [18, 0]);
  start.setHours(h, mm, 0, 0);
  return { title: p.type === 'surprise' ? 'Private event' : p.title, when: whenText(p), where: p.where, start, end: new Date(start.getTime() + 2 * 3600000), mine: [] };
}

const gcal = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;

// Opens Google Calendar (app or web) with the event filled in. Works everywhere, including Expo Go.
export async function openInGoogleCalendar(copy: CalCopy) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(copy.title)}&dates=${gcal(copy.start)}/${gcal(copy.end)}&location=${encodeURIComponent(copy.where)}&ctz=${encodeURIComponent(tz)}`;
  await Linking.openURL(url);
}

// Presents the phone's own "add event" screen (Apple Calendar plus any accounts added in Settings on iPhone;
// the calendar app on Android). Needs a development build: expo-calendar is not part of Expo Go in SDK 58,
// so it is loaded lazily and reports false instead of crashing there.
export async function addToPhoneCalendar(copy: CalCopy): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Calendar = require('expo-calendar');
    let calendar;
    if (Platform.OS === 'ios') {
      await Calendar.requestCalendarPermissions(true); // write-only access is enough to add an event
      calendar = Calendar.getDefaultCalendarSync();
    } else {
      const all = await Calendar.getCalendars();
      calendar = all.find((x: { allowsModifications?: boolean }) => x.allowsModifications) ?? all[0];
    }
    await calendar.addEventWithForm({ title: copy.title, startDate: copy.start, endDate: copy.end, location: copy.where });
    return true;
  } catch {
    return false;
  }
}
