import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Avatar, Button, ListBox, Pick, Row, Screen, Section, T } from '@/components/ui';
import { actions, useStore } from '@/data/store';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';

// Me → Favorites and groups. Groups are reusable lists of neighbors you plan with;
// favorites float to the top of every people picker.
export default function PeopleScreen() {
  const { c } = useTheme();
  const groups = useStore(s => s.groups);
  const favorites = useStore(s => s.favorites);
  const members = useStore(s => s.hood.members);
  const everyone = members.map(m => m.n).filter(n => n !== 'You');
  const [editing, setEditing] = useState<number | null>(null);
  const [newName, setNewName] = useState('');

  const create = () => {
    if (!newName.trim()) return toast('Give the group a name.');
    if (!actions.addGroup(newName, [])) return toast('You already have a group with that name.');
    setEditing(groups.length); setNewName(''); toast('Group created. Tap neighbors to add them.');
  };

  return (
    <Screen back title="Favorites and groups">
      <T variant="muted">Use these when you plan something. Tap a group to invite everyone in it, then add anyone else you want.</T>

      <Section title="Your groups">
        {groups.map((g, i) => (
          <ListBox key={g.name + i}>
            <Row first>
              <Icon name="users" color={c.ink} />
              <View style={{ flex: 1 }}>
                <T variant="strong" style={{ fontSize: 15 }}>{g.name}</T>
                <T variant="muted">{g.members.length ? g.members.join(', ') : 'No one yet'}</T>
              </View>
              <Button label={editing === i ? 'Done' : 'Edit'} onPress={() => setEditing(editing === i ? null : i)} />
            </Row>
            {editing === i && (
              <View style={{ padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: c.line }}>
                <View style={styles.chips}>{everyone.map(n => <Pick key={n} label={n} on={g.members.includes(n)} onPress={() => actions.toggleGroupMember(i, n)} />)}</View>
                <Button kind="danger" label="Delete group" onPress={() => { actions.deleteGroup(i); setEditing(null); toast(`Deleted “${g.name}.”`); }} style={{ alignSelf: 'flex-start' }} />
              </View>
            )}
          </ListBox>
        ))}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={newName} onChangeText={setNewName} placeholder="New group name" placeholderTextColor={c.muted} onSubmitEditing={create}
            style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} accessibilityLabel="New group name" />
          <Button kind="primary" label="Create" onPress={create} />
        </View>
      </Section>

      <Section title="Favorites">
        <ListBox>
          {everyone.map((n, i) => {
            const on = favorites.includes(n);
            return (
              <Row key={n} first={i === 0}>
                <Avatar name={n} size={40} ring={false} />
                <T variant="strong" style={{ flex: 1, fontSize: 15 }}>{n}</T>
                <Pressable onPress={() => { actions.toggleFavorite(n); toast(on ? `${n} removed from favorites` : `${n} added to favorites`); }} accessibilityRole="button" accessibilityLabel={`${on ? 'Remove from' : 'Add to'} favorites`} accessibilityState={{ selected: on }} hitSlop={8}
                  style={styles.star}>
                  <Icon name="star" color={on ? c.ember : c.muted} fill={on ? c.ember : 'none'} />
                </Pressable>
              </Row>
            );
          })}
        </ListBox>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  input: { flex: 1, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 44, fontFamily: fonts.body, fontSize: 15 },
  star: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
