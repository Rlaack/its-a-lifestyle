import Svg, { Path } from 'react-native-svg';
import { ICON_PATHS, type IconName } from '@/theme/paths';

type Props = { name: IconName; size?: number; color: string; strokeWidth?: number; fill?: string };

export function Icon({ name, size = 20, color, strokeWidth = 1.8, fill = 'none' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d={ICON_PATHS[name]} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill={fill} />
    </Svg>
  );
}
