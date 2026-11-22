import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { PeoplePicker } from '@/components/PeoplePicker';
import { toast } from '@/components/Toast';
import { Button, IconButton, ListBox, Notice, Pick, Row, Screen, Section, T } from '@/components/ui';
import { actions, useStore } from '@/data/store';
import { fonts, toneColors } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Who's on each calendar, adding people, and creating new calendars. Members only, no outside links.
// Ported from the prototype's calSheet, newCalForm, calAdd and createCal.
export default function Calendars() {
  const params = useLocalSearchParams<{ new?: string }>();
  const { c } = useTheme();
  const cals = useStore(s => s.cals);
  const hood = useStore(s => s.hood);
  const everyone = hood.members.map(m => m.n).filter(n => n !== 'You');
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(params.new === '1');
  const [name, setName] = useState('');
  const [people, setPeople] = useState<string[]>([]);

  const create = () => {
    if (!name.trim()) return toast('Give the calendar a name');
    if (!actions.createCalendar(name, people)) return toast('You already have a calendar with that name');
    toast(`${name.trim()} created${people.length ? ` with ${people.length} ${people.length === 1 ? 'neighbor' : 'neighbors'}` : ''}`);
    setCreating(false); setName(''); setPeople([]);
  };

  return (
    <Screen sheet title="Calendars" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <Notice title="Members only, no outside links">
        Calendars stay inside {hood.name}. Only neighbors added here can see them. To save one plan to your phone, open it and tap the calendar button.
      </Notice>

      {creating ? (
        <Section title="New calendar">
          <TextInput value={name} onChangeText={setName} placeholder="Sunday dinners" placeholderTextColor={c.muted} accessibilityLabel="Calendar name"
            style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />
          <PeoplePicker value={people} onChange={setPeople} />
          <T variant="muted">{people.length ? `${people.length + 1} people including you` : 'Just you so far. You can add people later too.'}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button grow kind="primary" label="Create" onPress={create} />
            <Button grow label="Cancel" onPress={() => setCreating(false)} />
          </View>
        </Section>
      ) : <Button kind="primary" icon="plus" label="New calendar" onPress={() => setCreating(true)} />}

      <Section title="Your calendars">
        <ListBox>
          {cals.map((cal, i) => {
            const [fg] = toneColors(c, cal.tone);
            return (
              <View key={cal.name}>
                <Row first={i === 0}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: fg }} />
                  <View style={{ flex: 1 }}>
                    <T variant="strong" style={{ fontSize: 15 }}>{cal.name}</T>
                    <T variant="muted">{i === 0 ? `Every member of ${hood.name}` : `${cal.n} neighbors`}</T>
                  </View>
                  {i > 0 && <Button label={open === i ? 'Done' : 'Add people'} onPress={() => setOpen(open === i ? null : i)} />}
                </Row>
                {open === i && (
                  <View style={[styles.chips, { borderTopColor: c.line }]}>
                    {everyone.map(n => {
                      const on = (cal.members ?? []).includes(n);
                      return <Pick key={n} label={n} on={on} onPress={() => { actions.toggleCalendarMember(i, n); toast(on ? `${n} removed from ${cal.name}` : `${n} added to ${cal.name}`); }} />;
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </ListBox>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 46, fontFamily: fonts.body, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, padding: 14, borderTopWidth: 1 },
});
