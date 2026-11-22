import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from './Icon';
import { Button, Pick, T } from './ui';
import { actions, groupIn, inviteSummary, useStore } from '@/data/store';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';

// Choose people for a plan: tap a group to add everyone in it, then add favorites or anyone else.
// In "except" mode the same picker chooses who will NOT see the plan.
export function PeoplePicker({ value, onChange, except, summaryLabel }: { value: string[]; onChange: (v: string[]) => void; except?: boolean; summaryLabel?: string }) {
  const { c } = useTheme();
  const allGroups = useStore(s => s.groups);
  const favorites = useStore(s => s.favorites);
  const members = useStore(s => s.hood.members);
  const everyone = members.map(m => m.n).filter(n => n !== 'You');
  // Only groups whose people are all in this neighborhood (sample groups don't show in a real one).
  const groups = allGroups.filter(g => g.members.length > 0 && g.members.every(n => everyone.includes(n)));
  const favs = favorites.filter(n => everyone.includes(n));
  const others = everyone.filter(n => !favorites.includes(n));
  const [naming, setNaming] = useState(false);
  const [groupName, setGroupName] = useState('');

  const toggle = (n: string) => onChange(value.includes(n) ? value.filter(x => x !== n) : [...value, n]);
  const toggleGroup = (i: number) => {
    const g = groups[i];
    if (!g) return;
    onChange(groupIn(g, value) ? value.filter(n => !g.members.includes(n)) : [...new Set([...value, ...g.members])]);
  };
  const saveGroup = () => {
    if (!groupName.trim()) return toast('Give the group a name.');
    if (!actions.addGroup(groupName, value)) return toast('You already have a group with that name.');
    toast(`Saved “${groupName.trim()}” with ${value.length} ${value.length === 1 ? 'person' : 'people'}.`);
    setNaming(false); setGroupName('');
  };
  const chip = (n: string) => <Pick key={n} label={n} on={value.includes(n)} no={except} onPress={() => toggle(n)} />;

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.group}>
        <Heading icon="users" label="Your groups" />
        <View style={styles.chips}>
          {groups.map((g, i) => <Pick key={g.name} label={`${g.name} · ${g.members.length}`} on={groupIn(g, value)} no={except} onPress={() => toggleGroup(i)} />)}
          <Pick label="+ Save as group" onPress={() => { toast(''); if (!value.length) toast('Pick some people first, then save them as a group.'); else setNaming(true); }} />
        </View>
        {naming && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={groupName} onChangeText={setGroupName} placeholder="Group name, like Dock crew" placeholderTextColor={c.muted} autoFocus
              style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} accessibilityLabel="Group name" onSubmitEditing={saveGroup} />
            <Button kind="primary" label="Save" onPress={saveGroup} />
          </View>
        )}
      </View>

      {favs.length > 0 && (
        <View style={styles.group}>
          <Heading icon="star" label="Favorites" />
          <View style={styles.chips}>{favs.map(chip)}</View>
        </View>
      )}

      <View style={styles.group}>
        <Heading label={favs.length ? 'Everyone else' : 'Neighbors'} />
        <View style={styles.chips}>{others.map(chip)}</View>
      </View>

      {value.length > 0 && (
        <T variant="muted">
          <Text style={{ fontFamily: fonts.bodyBold, color: c.ink }}>{summaryLabel ?? (except ? 'Hidden from: ' : 'Invited: ')}</Text>
          {inviteSummary(value, groups)} · {value.length} {value.length === 1 ? 'person' : 'people'}
        </T>
      )}
    </View>
  );
}

function Heading({ icon, label }: { icon?: 'users' | 'star'; label: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {icon && <Icon name={icon} size={15} color={c.muted} />}
      <Text style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: c.muted }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  input: { flex: 1, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 44, fontFamily: fonts.body, fontSize: 15 },
});
