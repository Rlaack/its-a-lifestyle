import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Icon } from './Icon';
import { useUnreadCount } from '@/data/activity';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

/** The bell in the top corner: opens the notification list, with a count of unread ones. */
export function NotificationBell() {
  const { c } = useTheme();
  const n = useUnreadCount();
  return (
    <Pressable onPress={() => router.push('/notifications')} accessibilityRole="button" hitSlop={6}
      accessibilityLabel={n ? `Notifications, ${n} unread` : 'Notifications'}
      style={({ pressed }) => [styles.btn, { backgroundColor: c.card, borderColor: c.line, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name="bell" color={c.ink} />
      {n > 0 && (
        <View style={[styles.badge, { backgroundColor: c.ember, borderColor: c.surface }]}>
          <Text style={[styles.count, { color: '#fff' }]}>{n > 99 ? '99+' : n}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  count: { fontFamily: fonts.bodyBold, fontSize: 11, lineHeight: 13 },
});
