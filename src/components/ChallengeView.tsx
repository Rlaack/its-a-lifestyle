import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DatePicker } from './DatePicker';
import { Icon } from './Icon';
import { toast } from './Toast';
import { Avatar, Button, ListBox, Notice, Pick, Row, Section, Segmented, T } from './ui';
import {
  addDaysISO, canLog, daysLeft, GRACE_DAYS, groupPoints, lastLoggableDay, phaseOf, pointsDelta, prettyISO, rulesText, scoreEntries,
  signupOpen, standings, teamStandings, unitOf,
} from '@/data/challenge';
import { actions } from '@/data/store';
import type { ChallengeEntry, Plan } from '@/data/types';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

const QUICK: Record<string, number[]> = { time: [15, 30, 45, 60, 90], distance: [1, 2, 3, 5, 10], count: [10, 20, 25, 50, 100] };
const fmtAmount = (n: number, unit: string) => (unit === 'min' ? (n < 60 ? `${n} min` : `${Math.round(n / 6) / 10} hr`) : `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`);

// A friendly challenge: rules, sign-up (with teams), quick logging that scores itself, standings,
// and your own log with edit and remove. Honor system, no health data.
export function ChallengeView({ p }: { p: Plan }) {
  const { c } = useTheme();
  const ch = p.challenge!;
  const phase = phaseOf(ch);
  const joined = p.going.includes('You');
  const organizer = p.host === 'You';
  const board = standings(p);
  const teams = teamStandings(p);
  const me = board.find(r => r.who === 'You');
  const unit = unitOf(ch);
  const choices = ch.mode === 'tasks' ? (ch.tasks ?? []).map(t => t.name) : ch.counts;

  const [team, setTeam] = useState<string | null>(null);
  const [what, setWhat] = useState(choices[0] ?? '');
  const [quick, setQuick] = useState<number | null>(QUICK[ch.mode]?.[1] ?? 1);
  const [custom, setCustom] = useState('');
  const [level, setLevel] = useState(0);
  const [day, setDay] = useState(lastLoggableDay(ch));
  const [pickDay, setPickDay] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const amount = ch.mode === 'tasks' || ch.mode === 'checkin' ? 1 : custom ? Number(custom) : quick ?? 0;
  const valid = Number.isFinite(amount) && amount > 0;
  const delta = valid && what ? pointsDelta(ch, 'You', { day, what, amount, level }, editing ?? undefined) : 0;

  const signUp = () => {
    const err = actions.joinChallenge(p.id, team ?? undefined);
    if (err) return toast(err);
    toast(joined ? 'You’re out of this one.' : phase === 'upcoming' ? `You’re in. Logging opens ${prettyISO(ch.start)}.` : 'You’re in. Log your first one below.');
  };
  const resetForm = () => { setEditing(null); setCustom(''); setDay(lastLoggableDay(ch)); setPickDay(false); };
  const log = () => {
    const err = actions.logActivity(p.id, { day, what, amount, level }, editing ?? undefined);
    if (err) return toast(err);
    toast(editing ? 'Entry updated.' : delta > 0 ? `Logged. +${delta} ${delta === 1 ? 'point' : 'points'}` : 'Logged. It adds up with your next one toward a point.');
    resetForm();
  };
  const edit = (e: ChallengeEntry) => {
    setEditing(e.id); setWhat(e.what); setLevel(e.level); setDay(e.day); setPickDay(true);
    if (QUICK[ch.mode]?.includes(e.amount)) { setQuick(e.amount); setCustom(''); } else setCustom(String(e.amount));
  };
  const myLog = ch.log.filter(e => e.who === 'You').sort((a, b) => b.day.localeCompare(a.day));
  const unassigned = ch.teams ? p.going.filter(w => !ch.teams!.of[w]) : [];

  const when = phase === 'upcoming' ? `Starts ${prettyISO(ch.start)}, runs to ${prettyISO(ch.end)}.`
    : phase === 'on' ? `${prettyISO(ch.start)} to ${prettyISO(ch.end)} · ${daysLeft(ch)} ${daysLeft(ch) === 1 ? 'day' : 'days'} left.`
    : phase === 'grace' ? `Ended ${prettyISO(ch.end)}. You have until ${prettyISO(addDaysISO(ch.end, GRACE_DAYS))} to finish logging.`
    : `Ended ${prettyISO(ch.end)}.`;

  return <>
    <Section title="How it works">
      <ListBox>
        <Row first><Icon name="trophy" color={c.pine} /><T style={{ flex: 1 }}>{rulesText(ch)}.</T></Row>
        {ch.mode !== 'tasks' && ch.mode !== 'checkin' && <Row><Icon name="check" color={c.pine} /><T style={{ flex: 1 }}>Counts: {ch.counts.join(', ')}. Points add up from your totals, so short sessions count too.</T></Row>}
        <Row><Icon name="clock" color={c.pine} /><T style={{ flex: 1 }}>{when}</T></Row>
        <Row><Icon name="users" color={c.pine} /><T style={{ flex: 1 }}>{signupOpen(ch) ? `Sign up by ${prettyISO(ch.signupBy)}.` : 'Sign-up is closed.'}{ch.teams ? ` Teams: ${ch.teams.names.join(' vs ')}${ch.teams.assign === 'choose' ? ', pick yours when you sign up' : ch.teams.assign === 'random' ? ', split evenly at random' : ', set by the organizer'}.` : ''}</T></Row>
        <Row><Icon name="hand" color={c.pine} /><T style={{ flex: 1 }}>Honor system. Log your own, and fix mistakes anytime while logging is open.</T></Row>
      </ListBox>
    </Section>

    {/* ---------- sign up ---------- */}
    {!joined && signupOpen(ch) && (
      <Section title="Sign up">
        {ch.teams?.assign === 'choose' && <>
          <T variant="muted">Pick your team.</T>
          <View style={styles.chips}>{ch.teams.names.map(n => <Pick key={n} label={n} on={team === n} onPress={() => setTeam(n)} />)}</View>
        </>}
        <Button kind="primary" icon="plus" label="Sign me up" onPress={signUp} />
      </Section>
    )}
    {!joined && !signupOpen(ch) && phase !== 'over' && <Notice icon="clock" title="Sign-up is closed">It closed {prettyISO(ch.signupBy)}. You can still follow the leaderboard.</Notice>}
    {joined && phase === 'upcoming' && <Notice icon="check" title="You’re signed up">{`Logging opens ${prettyISO(ch.start)}.${ch.teams?.of.You ? ` You’re on ${ch.teams.of.You}.` : ''}`}</Notice>}

    {/* ---------- log ---------- */}
    {joined && canLog(ch) && (
      <Section title={editing ? 'Edit your entry' : ch.mode === 'checkin' ? 'Check in' : ch.mode === 'tasks' ? 'Log a task' : 'Log your activity'}>
        {ch.mode !== 'checkin' && <View style={styles.chips}>{choices.map(a => <Pick key={a} label={ch.mode === 'tasks' ? `${a} · ${ch.tasks?.find(t => t.name === a)?.pts}` : a} on={what === a} onPress={() => setWhat(a)} />)}</View>}
        {QUICK[ch.mode] && (
          <View style={styles.chips}>
            {QUICK[ch.mode].map(m => <Pick key={m} label={fmtAmount(m, unit)} on={!custom && quick === m} onPress={() => { setQuick(m); setCustom(''); }} />)}
            <TextInput value={custom} onChangeText={v => setCustom(v.replace(ch.mode === 'distance' ? /[^0-9.]/g : /[^0-9]/g, '').slice(0, 5))}
              keyboardType={ch.mode === 'distance' ? 'decimal-pad' : 'number-pad'} placeholder={`Other ${unit}`} placeholderTextColor={c.muted}
              accessibilityLabel={`Amount in ${unit}`} style={[styles.amt, { borderColor: custom ? c.pine : c.line, color: c.ink, backgroundColor: c.card }]} />
          </View>
        )}
        {ch.levels.length > 1 && <Segmented small options={ch.levels.map((l, i) => [String(i), `${l.name} · ${l.pts}`] as [string, string])} value={String(level)} onChange={v => setLevel(Number(v))} />}
        <Pressable onPress={() => setPickDay(!pickDay)} accessibilityRole="button" style={[styles.dayRow, { borderColor: c.line, backgroundColor: c.card }]}>
          <Icon name="cal" size={18} color={c.pine} />
          <Text style={{ flex: 1, fontFamily: fonts.bodySemi, color: c.ink }}>{day === lastLoggableDay(ch) && phase === 'on' ? `Today, ${prettyISO(day)}` : prettyISO(day)}</Text>
          <Text style={{ fontFamily: fonts.bodySemi, color: c.pine }}>{pickDay ? 'Done' : 'Change day'}</Text>
        </Pressable>
        {pickDay && <DatePicker mode="single" value={day} onChange={d => { setDay(d); setPickDay(false); }} min={ch.start} max={lastLoggableDay(ch)} />}
        <Button kind="primary" label={!valid ? 'Enter an amount' : `${editing ? 'Save' : ch.mode === 'checkin' ? 'Check in' : 'Log it'} · ${delta >= 0 ? '+' : ''}${delta} ${Math.abs(delta) === 1 ? 'point' : 'points'}`} onPress={valid ? log : () => {}} />
        {editing && <Button label="Cancel editing" onPress={resetForm} />}
      </Section>
    )}

    {/* ---------- teams ---------- */}
    {teams.length > 0 && (
      <Section title="Teams">
        <ListBox>
          {teams.map((tm, i) => (
            <Row key={tm.name} first={i === 0}>
              <Text style={[styles.rank, { color: i === 0 && tm.pts > 0 ? c.ember : c.muted }]}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <T variant="strong" style={{ fontSize: 15, color: ch.teams?.of.You === tm.name ? c.pine : c.ink }}>{tm.name}{ch.teams?.of.You === tm.name ? ' (yours)' : ''}</T>
                <T variant="muted">{tm.members} {tm.members === 1 ? 'person' : 'people'} · {tm.avg} per person</T>
              </View>
              <Text style={[styles.pts, { color: c.ink }]}>{tm.pts}</Text>
            </Row>
          ))}
        </ListBox>
        {organizer && unassigned.length > 0 && <>
          <T variant="muted">{unassigned.length} {unassigned.length === 1 ? 'person has' : 'people have'} no team yet.</T>
          {ch.teams?.assign !== 'choose' && <Button label="Split everyone without a team evenly" onPress={() => { actions.splitTeams(p.id); toast('Teams split evenly.'); }} />}
        </>}
      </Section>
    )}

    {/* ---------- leaderboard ---------- */}
    <Section title="Leaderboard" right={<T variant="small">Together: {groupPoints(p)} points</T>}>
      {board.length ? (
        <ListBox>
          {(showAll ? board : board.slice(0, 8)).map((r, i) => (
            <Row key={r.who} first={i === 0}>
              <Text style={[styles.rank, { color: r.rank <= 3 && r.pts > 0 ? c.ember : c.muted }]}>{r.rank}</Text>
              <Avatar name={r.who} size={32} ring={false} />
              <View style={{ flex: 1 }}>
                <T variant="strong" style={{ fontSize: 15, color: r.who === 'You' ? c.pine : c.ink }}>{r.who}</T>
                <T variant="muted">{ch.mode === 'tasks' ? `${r.amount} ${r.amount === 1 ? 'task' : 'tasks'}` : ch.mode === 'checkin' ? `${new Set(ch.log.filter(e => e.who === r.who).map(e => e.day)).size} days` : fmtAmount(Math.round(r.amount * 100) / 100, unit)}{r.team ? ` · ${r.team}` : ''}</T>
              </View>
              {organizer && ch.teams && ch.teams.assign !== 'choose' && (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {ch.teams.names.map(n => <Pick key={n} label={n.slice(0, 6)} on={r.team === n} onPress={() => actions.setTeam(p.id, r.who, n)} />)}
                </View>
              )}
              <Text style={[styles.pts, { color: c.ink }]}>{r.pts}</Text>
            </Row>
          ))}
          {board.length > 8 && (
            <Pressable onPress={() => setShowAll(!showAll)} accessibilityRole="button" style={{ padding: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: c.line }}>
              <Text style={{ fontFamily: fonts.bodySemi, color: c.pine }}>{showAll ? 'Show top 8' : `Show all ${board.length}`}</Text>
            </Pressable>
          )}
        </ListBox>
      ) : <T variant="muted">No one has signed up yet.</T>}
      {me && <T variant="muted">You’re #{me.rank} of {board.length} with {me.pts} {me.pts === 1 ? 'point' : 'points'}.</T>}
    </Section>

    {/* ---------- my log ---------- */}
    {myLog.length > 0 && (
      <Section title="Your log" right={<T variant="small">{scoreEntries(myLog, ch)} points</T>}>
        <ListBox>
          {myLog.map((e, k) => (
            <Row key={e.id} first={k === 0}>
              <View style={{ flex: 1 }}>
                <T variant="strong" style={{ fontSize: 15 }}>{ch.mode === 'checkin' ? 'Checked in' : e.what}</T>
                <T variant="muted">{prettyISO(e.day)}{ch.mode !== 'tasks' && ch.mode !== 'checkin' ? ` · ${fmtAmount(e.amount, unit)}` : ''}{ch.levels.length > 1 ? ` · ${ch.levels[e.level]?.name.toLowerCase()}` : ''}</T>
              </View>
              {canLog(ch) && <>
                <Button label="Edit" onPress={() => edit(e)} />
                <Button label="Remove" onPress={() => { actions.removeEntry(p.id, e.id); if (editing === e.id) resetForm(); toast('Removed from your log'); }} />
              </>}
            </Row>
          ))}
        </ListBox>
      </Section>
    )}

    {joined && phase === 'upcoming' && <Button label="Drop out" onPress={signUp} />}
    <Notice icon="heart" title="No health data needed">Everyone logs their own. The app doesn’t read Apple Health, Google Health Connect or your location for this.</Notice>
  </>;
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  amt: { height: 36, minWidth: 96, borderWidth: 1, borderRadius: 99, paddingHorizontal: 13, fontFamily: fonts.bodySemi, fontSize: 13.5 },
  rank: { width: 22, textAlign: 'center', fontFamily: fonts.display, fontSize: 18 },
  pts: { fontFamily: fonts.display, fontSize: 20 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 46 },
});
