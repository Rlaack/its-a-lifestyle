import { Linking, Pressable, Text, View } from 'react-native';
import { Icon } from './Icon';
import { PRIVACY_URL, TERMS_URL } from '@/data/security';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

/** Required before joining or starting a neighborhood: age, and no tolerance for abusive content. */
export function AgreeRow({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const { c } = useTheme();
  const text = { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: c.muted };
  const link = { fontFamily: fonts.bodySemi, color: c.pine, textDecorationLine: 'underline' as const };
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Pressable onPress={() => onChange(!on)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel="I’m 18 or older and agree to the Terms and Privacy Policy" hitSlop={8}
        style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 1.5, borderColor: on ? c.pine : c.line, backgroundColor: on ? c.pine : c.card, alignItems: 'center', justifyContent: 'center' }}>
        {on && <Icon name="check" size={16} color={c.onPine} />}
      </Pressable>
      <Text style={[text, { flex: 1 }]}>
        I’m 18 or older and agree to the <Text style={link} onPress={() => Linking.openURL(TERMS_URL)}>Terms and Community Guidelines</Text>, including no abusive content or behavior, and the <Text style={link} onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>.
      </Text>
    </View>
  );
}
