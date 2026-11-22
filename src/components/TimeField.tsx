import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Icon } from './Icon';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// Time is kept as 'HH:MM' (24-hour) and shown as "6:30 PM".
export const formatTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
/** "6:00 PM" → "18:00" (for editing a posted plan). */
export const parseTime = (t: string, fallback: string) => {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return fallback;
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
};
const toDate = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const fromDate = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function TimeField({ value, onChange, label = 'Time' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const { c, isDark } = useTheme();

  if (Platform.OS === 'ios') {
    // iOS: the compact native picker (a pill that opens the system wheel).
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="clock" color={c.muted} />
        <Text style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: c.ink, flex: 1 }}>{label}</Text>
        <DateTimePicker value={toDate(value)} mode="time" display="compact" minuteInterval={5} accentColor={c.pine}
          themeVariant={isDark ? 'dark' : 'light'} onValueChange={(_, d) => onChange(fromDate(d))} accessibilityLabel={label} />
      </View>
    );
  }

  // Android opens the system clock dialog; web falls back to the same button.
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: toDate(value), mode: 'time', is24Hour: false, onValueChange: (_, d) => onChange(fromDate(d)) });
    }
  };
  return (
    <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${label}, ${formatTime(value)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: c.line, backgroundColor: c.card, borderRadius: 13, paddingHorizontal: 13, minHeight: 46 }}>
      <Icon name="clock" color={c.muted} />
      <Text style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: c.ink, flex: 1 }}>{label}</Text>
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 15, color: c.pine }}>{formatTime(value)}</Text>
    </Pressable>
  );
}
