import { ENCRYPTION_LIVE } from '@/data/security';
import { useState } from 'react';
import { Alert, Platform, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '@/components/Icon';
import { LakeLogo } from '@/components/LakeLogo';
import { Avatar, Button, Chip, IconButton, ListBox, Notice, Pick, Row, Screen, Section, Segmented, T } from '@/components/ui';
import { accountInCurrentHood, changeInviteCode, leaveHoodOnline, openSecureChat } from '@/data/secure/sync';
import { actions, hoodCount, useStore } from '@/data/store';
import type { Member } from '@/data/types';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { toast } from '@/components/Toast';
import { PlanNotice } from '@/components/PlanNotice';

export default function NeighborhoodScreen() {
  const { c } = useTheme();
  const hood = useStore(s => s.hood);
  const cur = useStore(s => s.cur);
  const verified = useStore(s => s.verified);
  const isOwner = hood.owners.includes('You');
  const all: Member[] = [...hood.members, ...(hood.extra ?? [])];
  const me = all.find(m => m.n === 'You');
  const canInvite = isOwner || hood.inviters === 'everyone' || !!me?.inv;
  // The last person left can delete the neighborhood instead of leaving it empty.
  const alone = all.every(m => m.n === 'You') && hood.more === 0;
  const coverLabel = hood.cover?.kind === 'photo' ? 'Your photo' : hood.cover?.kind === 'none' || hood.map !== 'lake' ? 'No picture' : 'The neighborhood drawing';
  const pickCover = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [16, 9], quality: 0.8 });
    if (r.canceled || !r.assets?.[0]) return;
    actions.setCover({ kind: 'photo', uri: r.assets[0].uri });
    toast('Cover photo set.');
  };
  const del = () => {
    const code = hood.code, remote = hood.remote;
    if (!actions.deleteHood()) return toast('Only the last member can delete a neighborhood.');
    if (remote) leaveHoodOnline(code).catch(() => {});
    router.replace('/');
    toast('Neighborhood deleted.');
  };

  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(hood.name);
  const [about, setAbout] = useState(hood.about);
  const [places, setPlaces] = useState(hood.places.join(', '));

  const query = q.trim().toLowerCase();
  const matches = query ? all.filter(m => m.n.toLowerCase().includes(query)) : all;
  const shown = query || showAll ? matches : matches.slice(0, 10);

  const invite = hood.invite ?? hood.code;
  const copy = async () => { await Clipboard.setStringAsync(invite); toast(`Copied ${invite}.`); };
  const share = () => Share.share({ message: `Join ${hood.name} on It’s a Lifestyle. Your join code is ${invite}.${hood.remote ? '' : ' It works for 7 days.'}` });
  const [changing, setChanging] = useState(false);
  const newCode = () => {
    if (!hood.remote) { actions.newJoinCode(); return toast('New code made. The old one stopped working.'); }
    Alert.alert('Make a new join code?', 'Everyone in the neighborhood stays in, and their phones switch to the new code by themselves. The old code and invite links stop working right away, so people you removed can’t use them to come back.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Make new code', onPress: async () => {
        setChanging(true);
        try { const next = await changeInviteCode(`r-${hood.code}`); toast(`New code: ${next}. The old one stopped working.`); }
        catch (e) { toast(e instanceof Error && !/relay/.test(e.message) ? e.message : 'Couldn’t reach the server. Nothing changed.'); }
        finally { setChanging(false); }
      } },
    ]);
  };
  const save = () => {
    if (!name.trim()) return toast('Give the neighborhood a name.');
    actions.saveHood(name.trim(), about.trim(), places.split(',').map(x => x.trim()).filter(Boolean));
    setEditing(false); toast('Saved.');
  };
  const leave = () => {
    if (!actions.leaveHood()) return toast('You’re the only owner. Make another member an owner first, so the neighborhood keeps going.');
    if (hood.remote) leaveHoodOnline(hood.code).catch(() => toast('Couldn’t reach the server. You’ll be removed next time you’re online.'));
    router.replace('/');
  };

  return (
    <Screen back title={hood.name}>
      {cur === 'lake' && <View style={{ alignItems: 'center' }}><LakeLogo height={84} /></View>}
      {!!hood.about && <T variant="muted" style={{ textAlign: 'center' }}>{hood.about}</T>}
      <Notice title="Members only">Only the {hoodCount(hood)} members of {hood.name} can see its plans, beacons, calendars and chats. Nothing here is public.</Notice>

      <PlanNotice isOwner={isOwner} />

      <Section title="Invite a neighbor">
        {canInvite ? <>
          <View style={[styles.code, { backgroundColor: c.pineSoft }]}>
            <View>
              <T variant="small">Join code</T>
              <Text style={[styles.codeText, { color: c.pine }]}>{invite}</Text>
              <T variant="small">Share it in person or send the link</T>
            </View>
            <Button label="Copy" onPress={copy} />
          </View>
          <Button kind="primary" icon="send" label="Send an invite link" onPress={share} />
        </> : <T variant="muted">Right now only people the owners choose can invite. Ask an owner for an invite.</T>}
      </Section>

      {isOwner && (
        <Section title="Owner settings">
          <ListBox>
            <View style={{ padding: 14, gap: 8 }}>
              <T variant="strong" style={{ fontSize: 15 }}>Who can invite</T>
              <T variant="muted">{hood.inviters === 'everyone' ? 'Any member can bring in a neighbor.' : 'Only members you mark below.'}</T>
              <Segmented small options={[['everyone', 'Every member'], ['chosen', 'People I choose']]} value={hood.inviters} onChange={actions.setInviters} />
            </View>
            <Row onPress={changing ? undefined : newCode}>
              <Icon name="flip" color={c.ink} />
              <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>{changing ? 'Making a new code…' : 'Make a new join code'}</T><T variant="muted">The old code and links stop working right away; members stay in</T></View>
            </Row>
            {editing ? (
              <View style={{ padding: 14, gap: 10, borderTopWidth: 1, borderTopColor: c.line }}>
                <Labeled label="Name"><Input value={name} onChangeText={setName} /></Labeled>
                <Labeled label="Description"><Input value={about} onChangeText={setAbout} multiline /></Labeled>
                <Labeled label="Common places" hint="Separate with commas. These show up as quick picks when people plan something.">
                  <Input value={places} onChangeText={setPlaces} placeholder="Beach, Clubhouse, Trail" />
                </Labeled>
                <View style={{ flexDirection: 'row', gap: 8 }}><Button grow kind="primary" label="Save" onPress={save} /><Button grow label="Cancel" onPress={() => setEditing(false)} /></View>
              </View>
            ) : (
              <Row onPress={() => setEditing(true)}>
                <Icon name="home2" color={c.ink} />
                <View style={{ flex: 1 }}><T variant="strong" style={{ fontSize: 15 }}>Edit name, description and places</T><T variant="muted">{hood.places.join(', ') || 'No common places yet'}</T></View>
              </Row>
            )}
            <View style={{ padding: 14, gap: 8, borderTopWidth: 1, borderTopColor: c.line }}>
              <T variant="strong" style={{ fontSize: 15 }}>Picture on the home screen</T>
              <T variant="muted">Now: {coverLabel}.{hood.remote ? ' Members see it too. A photo is encrypted on your phone before it’s shared.' : ''}</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                <Pick label="Choose a photo" on={hood.cover?.kind === 'photo'} onPress={pickCover} />
                {hood.map === 'lake' && <Pick label="Neighborhood drawing" on={!hood.cover || hood.cover.kind === 'drawing'} onPress={() => actions.setCover({ kind: 'drawing' })} />}
                <Pick label="No picture" on={hood.cover?.kind === 'none' || (!hood.cover && hood.map !== 'lake')} onPress={() => actions.setCover({ kind: 'none' })} />
              </View>
            </View>
            <Row>
              <Icon name="user" color={c.ink} />
              <View style={{ flex: 1 }}>
                <T variant="strong" style={{ fontSize: 15 }}>Owners · {hood.owners.length}</T>
                <T variant="muted">{hood.owners.join(', ').replace(/\.$/, '')}. Owners can remove people, change settings and make other members owners.</T>
              </View>
            </Row>
            {hood.owners.length > 1 && (
              <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
                <Button label="Step down as owner" onPress={() => { actions.removeOwner('You'); toast(`You’re no longer an owner of ${hood.name}.`); }} style={{ alignSelf: 'flex-start' }} />
              </View>
            )}
          </ListBox>
        </Section>
      )}

      <Section title={`Members · ${all.length}`}>
        <TextInput value={q} onChangeText={setQ} placeholder={`Search ${all.length} members`} placeholderTextColor={c.muted} accessibilityLabel="Search members"
          style={[styles.input, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />
        <ListBox>
          {shown.map((m, i) => {
            const owner = hood.owners.includes(m.n), isMe = m.n === 'You';
            return (
              <Row key={m.n} first={i === 0}>
                <Avatar name={m.n} size={40} ring={false} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <T variant="strong" style={{ fontSize: 15 }}>{m.n}</T>
                    {ENCRYPTION_LIVE && verified.includes(m.n) && <Icon name="check" size={14} color={c.pine} />}
                    {owner && <Chip label="Owner" tone="pine" />}
                  </View>
                  <T variant="muted">{m.by.startsWith('Started') ? `Started ${hood.name}` : m.by === 'Joined' ? 'Joined with the invite code' : `Invited by ${m.by}`}</T>
                  {isOwner && !isMe && (
                    confirm === m.n ? (
                      <View style={styles.btns}>
                        <T variant="muted">Remove {m.n} from {hood.name}?</T>
                        <Button kind="danger" label="Remove" onPress={() => { actions.removeMember(m.n); setConfirm(null); toast(`${m.n} was removed and can’t see ${hood.name} anymore.`); }} />
                        <Button label="Keep" onPress={() => setConfirm(null)} />
                      </View>
                    ) : (
                      <View style={styles.btns}>
                        {owner
                          ? <Button label="Remove as owner" onPress={() => { if (!actions.removeOwner(m.n)) toast('A neighborhood needs at least one owner.'); }} />
                          : <>
                            <Button label="Make owner" onPress={() => { actions.makeOwner(m.n); toast(`${m.n} is now an owner of ${hood.name}.`); }} />
                            {hood.inviters === 'chosen' && <Pick label={m.inv ? 'Can invite' : 'Can’t invite'} on={m.inv} onPress={() => actions.toggleCanInvite(m.n)} />}
                            <Button kind="danger" label="Remove" onPress={() => setConfirm(m.n)} />
                          </>}
                      </View>
                    )
                  )}
                </View>
                {!isMe && <IconButton name="chat" label={`Message ${m.n}`} onPress={() => {
                  // Shared neighborhoods: an end-to-end encrypted chat with that member's account.
                  const acct = hood.remote ? accountInCurrentHood(m.n) : undefined;
                  router.push(`/chat/${acct ? openSecureChat(acct, m.n, 'neighborhood') : actions.dmWith(m.n)}`);
                }} />}
              </Row>
            );
          })}
          {!shown.length && <Row first><T variant="muted">No members match “{q}”.</T></Row>}
        </ListBox>
        {!query && all.length > 10 && <Button label={showAll ? 'Show fewer' : `Show all ${all.length} members`} onPress={() => setShowAll(!showAll)} />}
      </Section>

      <Section>
        {alone ? (confirm === '__delete' ? (
          <View style={[styles.confirm, { backgroundColor: c.emberSoft, borderColor: c.ember + '55' }]}>
            <T variant="strong">Delete {hood.name}?</T>
            <T variant="muted">You’re the only member, so this removes the neighborhood and its plans for good. It can’t be undone.</T>
            <View style={{ flexDirection: 'row', gap: 8 }}><Button grow kind="ember" label="Delete" onPress={del} /><Button grow label="Keep it" onPress={() => setConfirm(null)} /></View>
          </View>
        ) : <Button kind="danger" label={`Delete ${hood.name}`} onPress={() => setConfirm('__delete')} />) : confirm === '__leave' ? (
          <View style={[styles.confirm, { backgroundColor: c.emberSoft, borderColor: c.ember + '55' }]}>
            <T variant="strong">Leave {hood.name}?</T>
            <T variant="muted">You’ll stop seeing its plans, beacons and chats. You can come back with a new invite or join code.</T>
            <View style={{ flexDirection: 'row', gap: 8 }}><Button grow kind="ember" label="Leave" onPress={leave} /><Button grow label="Stay" onPress={() => setConfirm(null)} /></View>
          </View>
        ) : <Button kind="danger" label={`Leave ${hood.name}`} onPress={() => setConfirm('__leave')} />}
      </Section>
    </Screen>
  );
}

function Labeled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><T variant="label">{label}</T>{children}{hint ? <T variant="muted">{hint}</T> : null}</View>;
}
function Input(props: React.ComponentProps<typeof TextInput>) {
  const { c } = useTheme();
  return <TextInput placeholderTextColor={c.muted} accessibilityLabel={props.placeholder} {...props} style={[styles.input, props.multiline && { minHeight: 80, textAlignVertical: 'top', paddingTop: 10 }, { borderColor: c.line, backgroundColor: c.card, color: c.ink }]} />;
}

const styles = StyleSheet.create({
  code: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 18 },
  codeText: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 26, letterSpacing: 3, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, minHeight: 44, fontFamily: fonts.body, fontSize: 15 },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' },
  confirm: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 10 },
});
