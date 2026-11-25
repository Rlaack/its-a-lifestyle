import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Image, KeyboardAvoidingView, Linking, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { EmojiPicker } from '@/components/EmojiPicker';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { IconButton, T, toneFor, useGutter } from '@/components/ui';
import { localUri } from '@/data/secure/attachments';
import { CHAT_REACTIONS } from '@/data/planTypes';
import { actions, useStore } from '@/data/store';
import type { Message } from '@/data/types';
import { LAKE_PATH } from '@/theme/paths';
import type { IconName } from '@/theme/paths';
import { fonts, toneColors, type Tone } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { ENCRYPTION_LIVE, NOT_ENCRYPTED_WARNING } from '@/data/security';
import { useHoodPaused } from '@/components/PlanNotice';
import { accountForName, isBlocked, reactToMessage, report, reportTarget, sendGroupAttachment, sendGroupChat, sendGroupLocation, sendSecure, sendSecureAttachment, sendSecureLocation, setBlocked, useSecureVersion } from '@/data/secure/sync';

type Rich = { f: string; gone?: boolean; mid?: string; status?: 'sending' | 'sent' | 'failed'; t?: string; type?: 'photo' | 'file' | 'loc' | 'voice'; src?: string; uri?: string; alt?: string; name?: string; size?: string; dur?: string; geo?: string; r?: Record<string, string[]> };
const fmtSize = (b: number) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : `${(b / 1e6).toFixed(1)} MB`);
const fmtDur = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`;

export default function ChatScreen() {
  const paused = useHoodPaused();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chat = useStore(s => s.chats.find(x => x.id === id));
  useSecureVersion();
  const verified = useStore(s => s.verified);
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const [reactFor, setReactFor] = useState<number | null>(null);
  const [panel, setPanel] = useState<'none' | 'emoji' | 'react' | 'attach' | 'voice'>('none');
  const list = useRef<FlatList<Message>>(null);
  const gutter = useGutter(14);
  if (!chat) return null;
  const dm = chat.members === 2;
  const encrypted = !!chat.secure || !!chat.shared;
  // Reactions work in every chat: encrypted ones send them to everyone in it; the sample chats stay on this phone.
  const react = (i: number, e: string) => {
    const m = chat.msgs[i] as Rich;
    if (encrypted && m?.mid) reactToMessage(chat, m.mid, e); else actions.reactMessage(chat.id, i, e);
  };
  // Someone you blocked: their messages are hidden here too, not just new ones.
  const fromBlocked = (m: Message) => { const f = (m as Rich).f; if (!f || f === 'You' || f === 'sys') return false; const a = accountForName(f, chat); return !!a && isBlocked(a); };
  const blockedHere = !!chat.secure && isBlocked(chat.secure.account);
  // Long-press a neighbor's message: report it to the neighborhood's owners, or block them.
  const moderate = (msg: Rich) => {
    const who = msg.f;
    const acct = accountForName(who, chat);
    if (!acct || who === 'You') return;
    const target = reportTarget(acct);
    const block = { text: isBlocked(acct) ? `Unblock ${who}` : `Block ${who}`, style: 'destructive' as const, onPress: () => {
      const on = !isBlocked(acct); setBlocked(acct, on, who); toast(on ? `Blocked ${who}. Their messages are hidden and they can’t message you.` : `Unblocked ${who}.`);
    } };
    const buttons = [
      ...(target && !target.iAmOwner && target.ownersOther.length ? [{ text: 'Report to owners', onPress: () => {
        report(target, { about: acct, aboutName: who, kind: 'message', text: msg.t ?? `[${msg.type ?? 'message'}]`, where: chat.name });
        toast(`Reported to the owners of ${target.hoodName}. Only they see it.`);
      } }] : []),
      block,
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(`Message from ${who}`, target?.iAmOwner ? `You’re an owner of ${target.hoodName}: you can remove ${who} from its member list.` : target ? `A report goes to the owners of ${target.hoodName}, encrypted, with this message’s text.` : `${who} isn’t in a neighborhood with you, so there are no owners to report to. You can block them.`, buttons);
  };

  const send = () => {
    const v = draft.trim();
    if (!v) return;
    if (chat.secure) sendSecure(chat.id, v);
    else if (chat.shared) sendGroupChat(chat, v);
    else actions.sendMessage(chat.id, v);
    setDraft('');
  };

  const pickPhoto = async () => {
    setPanel('none');
    // Encrypted chats: photos only for now, compressed so they stay under 6 MB.
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: encrypted ? ['images'] : ['images', 'videos'], quality: encrypted ? 0.6 : 0.8 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (chat.secure) return sendSecureAttachment(chat.id, a.uri);
    if (chat.shared) return sendGroupAttachment(chat, a.uri);
    if ((a.fileSize ?? 0) > 25e6) return toast('That file is over 25 MB. Pick a smaller one.');
    if (a.type === 'video') actions.sendRich(chat.id, { type: 'file', name: a.fileName ?? 'Video', size: `Video · ${fmtSize(a.fileSize ?? 0)}`, uri: a.uri });
    else actions.sendRich(chat.id, { type: 'photo', uri: a.uri, alt: a.fileName ?? 'Photo' });
  };
  const pickFile = async () => {
    setPanel('none');
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (encrypted) {
      if ((a.size ?? 0) > 6e6) return toast('That file is over 6 MB. Pick a smaller one.');
      const o = { kind: 'file' as const, name: a.name, size: a.size ?? 0 };
      return chat.secure ? sendSecureAttachment(chat.id, a.uri, o) : sendGroupAttachment(chat, a.uri, o);
    }
    if ((a.size ?? 0) > 25e6) return toast('That file is over 25 MB. Pick a smaller one.');
    actions.sendRich(chat.id, { type: 'file', name: a.name, size: fmtSize(a.size ?? 0), uri: a.uri });
  };
  // Location is only read when you choose to share it, rounded to about 1 km, after you confirm.
  const shareLocation = () => {
    setPanel('none');
    Alert.alert('Share your location?',
      `${chat.name} will see roughly where you are, rounded to about 1 km.${encrypted ? ' It’s encrypted on your phone before it’s sent.' : ENCRYPTION_LIVE ? '' : ' This chat isn’t encrypted, so only share it if you’re OK with that.'}`,
      [{ text: 'Cancel', style: 'cancel' }, {
        text: 'Share', onPress: async () => {
          const { granted } = await Location.requestForegroundPermissionsAsync();
          if (!granted) return toast('Location is off for It’s a Lifestyle. Nothing was shared.');
          try {
            const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
            const geo = `${p.coords.latitude.toFixed(2)},${p.coords.longitude.toFixed(2)}`;
            if (chat.secure) sendSecureLocation(chat.id, geo);
            else if (chat.shared) sendGroupLocation(chat, geo);
            else actions.sendRich(chat.id, { type: 'loc', t: 'My approximate location (about 1 km)', geo });
          } catch {
            toast('Couldn’t get your location. Nothing was shared.');
          }
        },
      }]);
  };

  const attach: [Tone, IconName, string, string, () => void][] = encrypted ? [
    ['sky', 'image', 'Photo', 'Encrypted on your phone first', pickPhoto],
    ['ember', 'pin', 'Location', 'Approximate, about 1 km', shareLocation],
    ['plum', 'mic', 'Voice message', 'Encrypted like photos', () => setPanel('voice')],
    ['pine', 'file', 'File', 'PDFs, docs, up to 6 MB', pickFile],
  ] : [
    ['sky', 'image', 'Photo or video', 'From your camera roll', pickPhoto],
    ['pine', 'file', 'File', 'PDFs, docs, anything', pickFile],
    ['ember', 'pin', 'Location', 'Approximate, about 1 km', shareLocation],
    ['plum', 'mic', 'Voice message', 'Record and send', () => setPanel('voice')],
    ['sky', 'poll', 'Poll', 'Pick a date or vote', () => { setPanel('none'); router.push('/create/poll'); }],
    ['pine', 'cal', 'Plan something', 'Beacon, potluck, hike', () => { setPanel('none'); router.push('/create'); }],
  ];

  const renderItem = ({ item: m, index: i }: { item: Message; index: number }) => {
    if (fromBlocked(m)) return null;
    if (m.f === 'sys') return <Text style={[styles.sys, { color: c.muted }]}>{'t' in m ? m.t : ''}</Text>;
    if (m.f === 'key') {
      const who = (m as { who: string }).who;
      return (
        <View style={[styles.note, { backgroundColor: c.card, borderColor: c.line }]}>
          <Icon name="shield" size={15} color={c.pine} />
          <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 12.5, color: c.muted }}>
            {who}’s security code changed. This usually means a new phone.{' '}
            <Text onPress={() => toast(`Usually nothing to do. Next time you see ${who.split(' ')[0]}, scan their code to re-verify.`)} accessibilityRole="button" style={{ fontFamily: fonts.bodySemi, color: c.pine }}>What to do</Text>
          </Text>
        </View>
      );
    }
    if (m.f === 'device') {
      const d = m as { who: string; dev: string };
      return <View style={[styles.note, { backgroundColor: c.card, borderColor: c.line }]}><Icon name="phone" size={15} color={c.pine} /><T variant="muted" style={{ flex: 1 }}>{d.who} linked a new device ({d.dev}). It was approved from their phone.</T></View>;
    }
    const msg = m as Rich;
    const me = msg.f === 'You';
    const [nameColor] = toneColors(c, toneFor(msg.f));
    const reactions = Object.entries(msg.r ?? {}).filter(([, l]) => l.length);
    const media = msg.type === 'photo' || msg.type === 'loc';
    const fg = me ? c.onPine : c.ink;
    // VoiceOver: one readable summary per message, report/block and reactions as swipe-up actions, and
    // bubbles with their own buttons (voice, file, map link) leave those reachable instead of hiding them.
    const what = msg.gone ? `${msg.type === 'photo' ? 'Photo' : msg.type === 'voice' ? 'Voice message' : 'File'}, not restored` : msg.type === 'photo' ? `Photo${msg.t ? `, ${msg.t}` : ''}` : msg.type === 'voice' ? `Voice message${msg.dur ? `, ${msg.dur}` : ''}`
      : msg.type === 'file' ? `File, ${msg.name ?? ''}` : msg.type === 'loc' ? 'Approximate location' : msg.t ?? '';
    const a11yLabel = `${me ? 'You' : msg.f}: ${what}${me && msg.status === 'sending' ? ', sending' : ''}`;
    const canModerate = encrypted && !me && !!accountForName(msg.f, chat);
    const a11yActions = [{ name: 'react', label: 'React' }, ...(canModerate ? [{ name: 'moderate', label: 'Report or block' }] : [])];
    const onA11yAction = (e: { nativeEvent: { actionName: string } }) => {
      if (e.nativeEvent.actionName === 'moderate') moderate(msg);
      if (e.nativeEvent.actionName === 'react') setReactFor(reactFor === i ? null : i);
    };
    const hasInner = !msg.gone && (msg.type === 'voice' || msg.type === 'file' || (msg.type === 'loc' && !!msg.geo));
    return (
      <View style={{ alignSelf: me ? 'flex-end' : 'flex-start', maxWidth: '80%', alignItems: me ? 'flex-end' : 'flex-start', gap: 3 }}>
        <Pressable onPress={() => setReactFor(reactFor === i ? null : i)} onLongPress={() => setReactFor(i)} delayLongPress={300}
          accessible={!hasInner} accessibilityLabel={hasInner ? undefined : a11yLabel} accessibilityActions={hasInner ? undefined : a11yActions} onAccessibilityAction={onA11yAction}
          accessibilityHint={hasInner ? undefined : canModerate ? 'Double-tap to react. Swipe up for report or block' : 'Double-tap to react'}
          style={[styles.bubble, media && { padding: 4 }, me ? { backgroundColor: c.pine, borderColor: c.pine } : { backgroundColor: c.card, borderColor: c.line }]}>
          {!me && chat.members > 2 && <Text style={{ fontFamily: fonts.bodyBold, fontSize: 11, color: nameColor, paddingHorizontal: media ? 8 : 0 }}>{msg.f}</Text>}
          {msg.type === 'photo' && (msg.uri
            ? <Image source={{ uri: localUri(msg.uri) }} style={styles.photo} accessibilityLabel={msg.alt ?? 'Photo'} />
            : encrypted ? <View style={[styles.photo, { alignItems: 'center', justifyContent: 'center', padding: 12 }]}><Text style={{ fontFamily: fonts.body, color: fg, textAlign: 'center' }}>{msg.gone ? 'Photo not restored (backups don’t include photos)' : 'Loading photo…'}</Text></View>
            : <SamplePhoto />)}
          {msg.type === 'loc' && !msg.geo && <MiniLake />}
          {msg.type === 'file' && <Pressable onPress={msg.uri ? () => Share.share({ url: localUri(msg.uri!) }) : undefined} disabled={!msg.uri} accessibilityRole="button" accessibilityLabel={`${me ? 'You' : msg.f}: file, ${msg.name ?? ''}${msg.uri ? '. Double-tap to open' : ', loading'}`} accessibilityActions={a11yActions} onAccessibilityAction={onA11yAction} style={styles.row}><Icon name="file" color={fg} /><View><Text style={{ fontFamily: fonts.bodySemi, color: fg }}>{msg.name}</Text><Text style={{ fontFamily: fonts.body, fontSize: 12, color: fg, opacity: 0.75 }}>{msg.gone ? 'Not restored' : msg.size}</Text></View></Pressable>}
          {msg.type === 'voice' && msg.gone && <Text style={{ fontFamily: fonts.body, color: fg, opacity: 0.8, padding: 4 }}>Voice message not restored</Text>}
          {msg.type === 'voice' && !msg.gone && <VoiceBubble uri={msg.uri ? localUri(msg.uri) : undefined} dur={msg.dur} color={fg} who={me ? 'You' : msg.f} actions={a11yActions} onAction={onA11yAction} />}
          {!!msg.t && <Text accessibilityLabel={hasInner ? `${me ? 'You' : msg.f}: ${msg.t}` : undefined} style={{ fontFamily: fonts.body, fontSize: 15, color: fg, padding: media ? 6 : 0 }}>{msg.type === 'loc' ? `📍 ${msg.t}` : msg.t}</Text>}
          {msg.type === 'loc' && !!msg.geo && (
            <Text onPress={() => Linking.openURL(Platform.OS === 'ios' ? `https://maps.apple.com/?ll=${msg.geo}&q=Shared%20location` : `geo:${msg.geo}?q=${msg.geo}`)}
              accessibilityRole="link" accessibilityLabel="Open this location in Maps" accessibilityActions={a11yActions} onAccessibilityAction={onA11yAction} style={{ fontFamily: fonts.bodySemi, fontSize: 14, color: fg, textDecorationLine: 'underline', paddingHorizontal: 6, paddingBottom: 6 }}>Open in Maps</Text>
          )}
        </Pressable>
        {me && msg.status === 'sending' && <T variant="muted" style={{ fontSize: 11.5 }}>Sending…</T>}
        {me && msg.status === 'failed' && (
          <Pressable onPress={() => (encrypted && msg.type === 'photo' ? toast('Pick the photo again to resend it.') : chat.secure ? sendSecure(chat.id, msg.t ?? '', msg.mid) : toast('It will be sent again automatically once you’re back online.'))} accessibilityRole="button" accessibilityLabel="Not sent. Tap to try again.">
            <Text style={{ fontFamily: fonts.bodySemi, fontSize: 11.5, color: c.ember }}>Not sent · Tap to try again</Text>
          </Pressable>
        )}
        {reactFor === i && (
          <View style={[styles.reactbar, { backgroundColor: c.card, borderColor: c.line }]}>
            {CHAT_REACTIONS.map(e => <Pressable key={e} onPress={() => { react(i, e); setReactFor(null); }} accessibilityRole="button" accessibilityLabel={`React with ${e}`} style={styles.reactBtn}><Text style={{ fontSize: 20 }}>{e}</Text></Pressable>)}
            <Pressable onPress={() => setPanel('react')} accessibilityRole="button" accessibilityLabel="More reactions" style={styles.reactBtn}><Icon name="plus" size={16} color={c.muted} /></Pressable>
            {canModerate && <Pressable onPress={() => { setReactFor(null); moderate(msg); }} accessibilityRole="button" accessibilityLabel={`Report or block ${msg.f}`} style={[styles.reactBtn, { width: 'auto', paddingHorizontal: 8 }]}><Text style={{ fontFamily: fonts.bodySemi, fontSize: 13, color: c.ember }}>Report or block</Text></Pressable>}
          </View>
        )}
        {reactions.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
            {reactions.map(([e, l]) => (
              <Pressable key={e} onPress={() => react(i, e)} accessibilityRole="button" accessibilityLabel={`${e} reaction, ${l.length}${l.includes('You') ? ', including you' : ''}`} style={[styles.react, { backgroundColor: l.includes('You') ? c.pineSoft : c.card, borderColor: l.includes('You') ? c.pine : c.line }]}>
                <Text style={{ fontSize: 12.5, color: c.ink }}>{e} {l.length}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.surface }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.hdr, { paddingHorizontal: gutter, paddingTop: insets.top + 10, borderBottomColor: c.line }]}>
        <IconButton name="back" label="Back" onPress={() => router.back()} />
        <Text style={{ flex: 1, fontFamily: fonts.logo, fontSize: 22, color: c.ink }} numberOfLines={1}>{chat.name}</Text>
      </View>
      {chat.shared ? (
        <Pressable onPress={() => router.push(`/chat-info/${chat.id}`)} accessibilityRole="button" style={[styles.e2e, { backgroundColor: c.pineSoft }]}>
          <Icon name="lock" size={14} color={c.pine} />
          <T variant="muted">End-to-end encrypted{chat.shared.plan ? ' · only people invited to this plan' : ` · ${chat.members} people`}{chat.timer && chat.timer !== 'Off' ? ` · disappears after ${chat.timer}` : ''} · <Text style={{ textDecorationLine: 'underline' }}>Details</Text></T>
        </Pressable>
      ) : chat.secure ? (
        <Pressable onPress={() => router.push(`/chat-info/${chat.id}`)} accessibilityRole="button" style={[styles.e2e, { backgroundColor: chat.secure.unknown ? c.emberSoft : c.pineSoft }]}>
          <Icon name={chat.secure.unknown ? 'shield' : 'lock'} size={14} color={chat.secure.unknown ? c.ember : c.pine} />
          <T variant="muted">
            End-to-end encrypted{chat.secure.verified ? ' · verified in person' : chat.secure.unknown ? ' · not one of your connections' : ''}{chat.timer && chat.timer !== 'Off' ? ` · disappears after ${chat.timer}` : ''} · <Text style={{ textDecorationLine: 'underline' }}>Details</Text>
          </T>
        </Pressable>
      ) : (
      <Pressable onPress={() => router.push(`/chat-info/${chat.id}`)} accessibilityRole="button" style={[styles.e2e, { backgroundColor: ENCRYPTION_LIVE ? c.pineSoft : c.emberSoft }]}>
        <Icon name={ENCRYPTION_LIVE ? 'lock' : 'shield'} size={14} color={ENCRYPTION_LIVE ? c.pine : c.ember} />
        <T variant="muted">
          {ENCRYPTION_LIVE ? 'Encrypted' : 'Not encrypted'} · {chat.members} {dm ? 'people' : 'members'}{ENCRYPTION_LIVE && dm && verified.includes(chat.name) ? ' · verified in person' : ''}
          {chat.timer && chat.timer !== 'Off' ? ` · disappears after ${chat.timer}` : ''}{chat.secret ? ' · hidden from Owen P.' : ''} · <Text style={{ textDecorationLine: 'underline' }}>Details</Text>
        </T>
      </Pressable>
      )}
      <FlatList ref={list} data={chat.msgs} renderItem={renderItem} keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 14, paddingHorizontal: gutter, paddingBottom: 22, gap: 6 }} onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })} />

      {panel === 'attach' && (
        <View style={[styles.attach, { backgroundColor: c.card, borderTopColor: c.line }]}>
          {attach.map(([tone, icon, label, sub, fn]) => {
            const [fg, bg] = toneColors(c, tone);
            return (
              <Pressable key={label} onPress={fn} accessibilityRole="button" style={[styles.tile, { borderColor: c.line, backgroundColor: c.surface }]}>
                <View style={[styles.tileIc, { backgroundColor: bg }]}><Icon name={icon} color={fg} /></View>
                <Text style={{ fontFamily: fonts.bodySemi, color: c.ink }}>{label}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: c.muted }}>{sub}</Text>
              </Pressable>
            );
          })}
          <T variant="muted" style={{ width: '100%' }}>{encrypted ? 'Photos are encrypted on your phone with their own key before they’re sent. Our server only stores scrambled data and deletes it after 30 days.' : ENCRYPTION_LIVE ? 'Photos and files are encrypted on your phone before they’re sent, just like messages.' : NOT_ENCRYPTED_WARNING}</T>
        </View>
      )}
      {panel === 'voice' && <VoiceRecorder onSend={(uri, dur) => {
        if (chat.secure) sendSecureAttachment(chat.id, uri, { kind: 'voice', dur });
        else if (chat.shared) sendGroupAttachment(chat, uri, { kind: 'voice', dur });
        else actions.sendRich(chat.id, { type: 'voice', uri, dur });
        setPanel('none');
      }} onCancel={() => setPanel('none')} />}
      {panel === 'emoji' && <EmojiPicker onPick={e => setDraft(d => d + e)} />}
      {panel === 'react' && reactFor !== null && (
        <EmojiPicker heading="Pick a reaction" onCancel={() => setPanel('none')} onPick={e => { react(reactFor, e); setReactFor(null); setPanel('none'); }} />
      )}

      {chat.system || blockedHere ? (
        <View style={[styles.composer, { paddingHorizontal: gutter, backgroundColor: c.card, borderTopColor: c.line, paddingBottom: Math.max(insets.bottom, 10), justifyContent: 'center' }]}>
          {chat.system ? <T variant="muted">Only the app posts here.</T>
            : <Pressable onPress={() => { setBlocked(chat.secure!.account, false, chat.name); toast(`Unblocked ${chat.name}.`); }} accessibilityRole="button">
                <T variant="muted">You blocked {chat.name}. <Text style={{ color: c.pine, fontFamily: fonts.bodySemi }}>Unblock</Text></T>
              </Pressable>}
        </View>
      ) : paused && chat.shared?.plan ? (
        <View style={{ paddingHorizontal: gutter, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12), backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.line }}>
          <T variant="muted" style={{ textAlign: 'center' }}>This neighborhood is paused. Open its page to bring it back.</T>
        </View>
      ) : (
      <View style={[styles.composer, { paddingHorizontal: gutter, backgroundColor: c.card, borderTopColor: c.line, paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable onPress={() => setPanel(panel === 'attach' ? 'none' : 'attach')} accessibilityRole="button" accessibilityLabel={panel === 'attach' ? 'Close attachments' : encrypted ? 'Add a photo, voice message, file or location' : 'Add a photo, file, location or more'} style={styles.cbtn}>
          <Icon name={panel === 'attach' ? 'x' : 'plus'} color={c.muted} />
        </Pressable>
        <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={send} placeholder="Message" placeholderTextColor={c.muted} returnKeyType="send"
          onFocus={() => panel !== 'none' && setPanel('none')} style={[styles.input, { borderColor: c.line, backgroundColor: c.surface, color: c.ink }]} accessibilityLabel="Message" />
        <Pressable onPress={() => setPanel(panel === 'emoji' ? 'none' : 'emoji')} accessibilityRole="button" accessibilityLabel="Emoji keyboard" accessibilityState={{ selected: panel === 'emoji' }} style={styles.cbtn}>
          <Icon name="smile" color={panel === 'emoji' ? c.pine : c.muted} />
        </Pressable>
        <Pressable onPress={send} accessibilityRole="button" accessibilityLabel="Send" style={[styles.send, { backgroundColor: c.pine }]}><Icon name="send" color={c.onPine} /></Pressable>
      </View>
      )}
    </KeyboardAvoidingView>
  );
}

function VoiceRecorder({ onSend, onCancel }: { onSend: (uri: string, dur: string) => void; onCancel: () => void }) {
  const { c } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { toast('Microphone access is off. Turn it on in Settings to send voice messages.'); onCancel(); return; }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      setReady(true);
    })();
  }, [onCancel]);
  const start = async () => {
    try {
      // Never leave the button dead: if the microphone doesn't come up in a few seconds, say so.
      await Promise.race([
        recorder.prepareToRecordAsync(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Microphone did not start in time')), 5000)),
      ]);
      recorder.record();
    }
    catch (e) { console.warn('Voice recording failed to start', e); toast('Couldn’t start recording. Check that the microphone is free and try again.'); }
  };
  const stopAndSend = async () => {
    const ms = state.durationMillis;
    try { await recorder.stop(); } catch (e) { console.warn('Voice recording failed to stop', e); }
    if (recorder.uri) onSend(recorder.uri, fmtDur(ms)); else toast('Nothing was recorded, so nothing was sent.');
  };
  return (
    <View style={[styles.voice, { backgroundColor: c.card, borderTopColor: c.line }]}>
      <Icon name="mic" color={state.isRecording ? c.ember : c.muted} />
      <Text style={{ flex: 1, fontFamily: fonts.bodySemi, color: c.ink }}>{state.isRecording ? `Recording · ${fmtDur(state.durationMillis)}` : ready ? 'Tap record, then send when you’re done' : 'Getting the microphone ready…'}</Text>
      {state.isRecording
        ? <Pressable onPress={stopAndSend} accessibilityRole="button" style={[styles.pill, { backgroundColor: c.pine }]}><Text style={{ fontFamily: fonts.bodySemi, color: c.onPine }}>Send</Text></Pressable>
        : <Pressable disabled={!ready} onPress={start} accessibilityRole="button" accessibilityState={{ disabled: !ready }} style={[styles.pill, { backgroundColor: c.ember, opacity: ready ? 1 : 0.5 }]}><Text style={{ fontFamily: fonts.bodySemi, color: c.onPine }}>Record</Text></Pressable>}
      <Pressable onPress={async () => { if (state.isRecording) await recorder.stop(); onCancel(); }} accessibilityRole="button" accessibilityLabel="Cancel recording"><Icon name="x" color={c.muted} /></Pressable>
    </View>
  );
}

type A11yAction = { name: string; label: string };
function VoiceBubble({ uri, dur, color, who, actions: a11y, onAction }: { uri?: string; dur?: string; color: string; who?: string; actions?: A11yAction[]; onAction?: (e: { nativeEvent: { actionName: string } }) => void }) {
  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);
  return (
    <Pressable onPress={() => { if (!uri) return; if (status.playing) player.pause(); else { if (status.didJustFinish || status.currentTime >= status.duration) player.seekTo(0); player.play(); } }}
      accessibilityRole="button" accessibilityLabel={`${who ? `${who}: ` : ''}voice message${dur ? `, ${dur}` : ''}${!uri ? ', loading' : ''}`} accessibilityHint={uri ? (status.playing ? 'Double-tap to pause' : 'Double-tap to play') : undefined}
      accessibilityActions={a11y} onAccessibilityAction={onAction} style={styles.row}>
      <Icon name={status.playing ? 'x' : 'play'} size={16} color={color} />
      <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center', height: 24 }}>
        {[6, 12, 18, 10, 20, 14, 8, 16, 22, 12, 7, 15, 19, 9, 13].map((h, i) => <View key={i} style={{ width: 3, height: h, borderRadius: 2, backgroundColor: color, opacity: 0.65 }} />)}
      </View>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color, opacity: 0.8 }}>{dur}</Text>
    </Pressable>
  );
}

function MiniLake() {
  const { c } = useTheme();
  return (
    <Svg width={220} height={99} viewBox="0 0 200 90" style={{ borderRadius: 14 }}>
      <Rect width="200" height="90" fill={c.pineSoft} />
      <Path d={LAKE_PATH} fill={c.water} transform="translate(40 -6) scale(1.05)" />
      <Circle cx="64" cy="58" r="16" fill={c.ember} opacity={0.25} />
      <Circle cx="64" cy="58" r="5" fill={c.ember} />
    </Svg>
  );
}

// The prototype's sample photo: a green paddleboard pulled up on the beach.
function SamplePhoto() {
  return (
    <Svg width={220} height={147} viewBox="0 0 240 160">
      <Rect width="240" height="160" fill="#BFE3EC" />
      <Path d="M0 92L20 60L40 92L55 66L75 92L95 58L118 92L140 64L160 92L182 56L205 92L222 66L240 92Z" fill="#1F4A37" />
      <Rect y="90" width="240" height="70" fill="#4A93A8" />
      <Path d="M0 118Q120 100 240 122V160H0Z" fill="#E8D7B3" />
      <Rect x="70" y="118" width="110" height="14" rx="7" fill="#3E9B5B" transform="rotate(-6 125 125)" />
      <Circle cx="196" cy="34" r="12" fill="#F6E3B0" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  hdr: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  e2e: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', margin: 12, marginBottom: 0, padding: 8, borderRadius: 12 },
  sys: { alignSelf: 'center', fontFamily: fonts.body, fontSize: 12, textAlign: 'center', paddingVertical: 4 },
  note: { alignSelf: 'center', flexDirection: 'row', gap: 8, padding: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, maxWidth: '92%' },
  bubble: { paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, gap: 2, overflow: 'hidden' },
  photo: { width: 220, height: 165, borderRadius: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reactbar: { flexDirection: 'row', borderRadius: 99, borderWidth: 1, paddingHorizontal: 4 },
  reactBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  react: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 99, borderWidth: 1 },
  attach: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, borderTopWidth: 1 },
  tile: { width: '31.5%', flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: 10, gap: 4 },
  tileIc: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingHorizontal: 14, borderTopWidth: 1 },
  pill: { paddingHorizontal: 14, minHeight: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, paddingHorizontal: 10, borderTopWidth: 1 },
  cbtn: { width: 34, height: 42, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 42, borderRadius: 21, borderWidth: 1, paddingHorizontal: 16, fontFamily: fonts.body, fontSize: 15 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
