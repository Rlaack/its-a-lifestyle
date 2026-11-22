// Design tokens carried over from the clickable prototype (v18).
// Light is airy with a lighter pine; dark reads as dusk, not black.

export type Palette = {
  bg: string; surface: string; card: string; ink: string; muted: string; line: string;
  pine: string; pineSoft: string; onPine: string;
  ember: string; emberSoft: string;
  plum: string; plumSoft: string;
  sky: string; skySoft: string;
  water: string; tree: string; dusk: string; sand: string; stars: string;
};

export const light: Palette = {
  bg: '#EDF2EC', surface: '#FAFCF8', card: '#FFFFFF', ink: '#1D2C25', muted: '#5E6F66', line: '#E0E8E1',
  pine: '#2B6C50', pineSoft: '#E2F0E7', onPine: '#FFFFFF',
  ember: '#D96A24', emberSoft: '#FDEBDD',
  plum: '#76508A', plumSoft: '#EEE3F3',
  sky: '#227590', skySoft: '#DDEFF3',
  water: '#4A93A8', tree: '#1D4634', dusk: '#F4DCC4', sand: '#E8D7B3', stars: 'transparent',
};

export const dark: Palette = {
  bg: '#111A16', surface: '#19231F', card: '#222E29', ink: '#EEF3EF', muted: '#A6B6AD', line: '#33433B',
  pine: '#7FCFA6', pineSoft: '#264535', onPine: '#0E1A14',
  ember: '#FF9A4D', emberSoft: '#46301F',
  plum: '#CDA6DE', plumSoft: '#3A2D43',
  sky: '#86CEE2', skySoft: '#1E3C47',
  water: '#2B6577', tree: '#0D1C15', dusk: '#2A3A52', sand: '#6B5B3E', stars: '#F3E9D6',
};

export type Tone = 'pine' | 'ember' | 'plum' | 'sky';
export const toneColors = (c: Palette, t: Tone) =>
  ({ pine: [c.pine, c.pineSoft], ember: [c.ember, c.emberSoft], plum: [c.plum, c.plumSoft], sky: [c.sky, c.skySoft] } as const)[t]
  ?? ([c.pine, c.pineSoft] as const); // unknown tone: fall back instead of crashing

// Font family names as registered by @expo-google-fonts.
export const fonts = {
  logo: 'AlfaSlabOne_400Regular',      // trail-sign slab: logo, screen titles, event titles
  display: 'BricolageGrotesque_700Bold',
  displayHeavy: 'BricolageGrotesque_800ExtraBold',
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemi: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
} as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22 } as const;
