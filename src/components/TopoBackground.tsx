import { StyleSheet } from 'react-native';
import Svg, { Defs, Ellipse, G, Path, Pattern, Rect } from 'react-native-svg';
import { useTheme } from '@/theme/theme';

// The prototype's faint topographic contour lines, tiled behind every screen.
export function TopoBackground() {
  const { c, isDark } = useTheme();
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}>
      <Defs>
        <Pattern id="topo" width="260" height="260" patternUnits="userSpaceOnUse">
          <G fill="none" stroke={c.pine} strokeOpacity={isDark ? 0.06 : 0.07} strokeWidth={1.1}>
            <Path d="M-10 50c45-28 85 18 135-6s95-38 145 2" />
            <Path d="M-10 70c45-28 85 18 135-6s95-38 145 2" />
            <Path d="M-10 165c55 24 95-24 145 0s75 28 125 4" />
            <Path d="M-10 185c55 24 95-24 145 0s75 28 125 4" />
            <Path d="M-10 205c55 24 95-24 145 0s75 28 125 4" />
            <Ellipse cx="190" cy="112" rx="34" ry="16" />
            <Ellipse cx="190" cy="112" rx="18" ry="7" />
          </G>
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#topo)" />
    </Svg>
  );
}
