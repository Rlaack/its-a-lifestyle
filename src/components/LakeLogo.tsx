import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LAKE_PATH } from '@/theme/paths';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

// The app's logo: the antler-shaped lake beside "it's a / lifestyle".
export function LakeLogo({ height = 60 }: { height?: number }) {
  const { c } = useTheme();
  const fontSize = height * 0.33;
  return (
    <View style={styles.row} accessibilityRole="image" accessibilityLabel="It's a Lifestyle">
      <Svg width={height * 0.82} height={height} viewBox="8 6 74 90">
        <Path d={LAKE_PATH} fill={c.sky} />
      </Svg>
      <View>
        <Text style={[styles.word, { fontSize, lineHeight: fontSize * 1.05, color: c.pine }]}>it’s a</Text>
        <Text style={[styles.word, { fontSize, lineHeight: fontSize * 1.05, color: c.ember }]}>lifestyle</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  word: { fontFamily: fonts.logo },
});
