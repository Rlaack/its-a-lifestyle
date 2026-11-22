import { View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from '@/components/Icon';
import { Avatar, Button, IconButton, ListBox, Row, Screen, T } from '@/components/ui';
import { PLAN_TYPES } from '@/data/planTypes';
import { useStore } from '@/data/store';
import type { Message } from '@/data/types';
import { toneColors } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';
import { NOT_ENCRYPTED_WARNING, SENSITIVE_INFO_NOTICE } from '@/data/security';

export function preview(m: Message) {
  if (m.f === 'sys') return 't' in m ? m.t ?? '' : '';
  if (m.f === 'key' || m.f === 'device') return 'Security notice';
  const who = m.f === 'You' ? 'You' : m.f.split(' ')[0];
  const x = m as { t?: string; type?: string; name?: string };
  const body = x.type ? ({ photo: '📷 Photo', file: `📄 ${x.name}`, loc: '📍 Location', voice: '🎙 Voice message' } as Record<string, string>)[x.type] : x.t;
  return `${who}: ${body}`;
}

export default function Chats() {
  const { c } = useTheme();
  const chats = useStore(s => s.chats);
  const plans = useStore(s => s.plans);
  return (
    <Screen title="Chats" right={<IconButton name="plus" label="New chat" onPress={() => router.push('/new-chat')} />}>
      {chats.some(ch => !ch.secure && !ch.shared && !ch.system) && (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: c.emberSoft, borderWidth: 1, borderColor: c.ember }}>
          <Icon name="shield" size={16} color={c.ember} />
          <T style={{ flex: 1, fontSize: 14 }}>{NOT_ENCRYPTED_WARNING}</T>
        </View>
      )}
      <T variant="muted">{SENSITIVE_INFO_NOTICE}</T>
      <Button kind="primary" icon="chat" label="New chat" onPress={() => router.push('/new-chat')} />
      <ListBox>
        {chats.map((ch, i) => {
          const plan = ch.gid ? plans.find(p => p.id === ch.gid) : undefined;
          const type = plan ? PLAN_TYPES[plan.type] : undefined;
          const [fg, bg] = toneColors(c, type?.tone ?? 'sky');
          return (
            <Row key={ch.id} first={i === 0} onPress={() => router.push(`/chat/${ch.id}`)}>
              {type || ch.icon
                ? <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={type?.icon ?? (ch.system ? 'shield' : 'wave')} color={fg} /></View>
                : <Avatar name={ch.name} size={42} ring={false} />}
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  {(ch.secure || ch.shared) && <Icon name="lock" size={13} color={c.pine} />}
                  <T variant="strong" style={{ fontSize: 15 }}>{ch.name}</T>
                </View>
                <T variant="muted" numberOfLines={1}>{ch.secret ? '🤫 ' : ''}{preview(ch.msgs[ch.msgs.length - 1])}</T>
              </View>
            </Row>
          );
        })}
      </ListBox>
    </Screen>
  );
}
