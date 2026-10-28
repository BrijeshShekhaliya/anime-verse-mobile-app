// Same palette and type as the AnimeVerse website (public/styles.css).
export const colors = {
  bg: '#000000',
  surface: '#141519',
  surface2: '#23252b',
  surface3: '#2f3138',
  line: '#2b2d33',
  text: '#ffffff',
  text2: '#dadada',
  muted: '#a0a0a0',
  accent: '#ff640a',
  accent2: '#ff8a3d',
  pink: '#ff3d6e',
  star: '#ffc12e',
  dub: '#2abdbb',
  sub: '#a7a7ff',
  danger: '#ff5c5c',
  green: '#5fd068',
};

export const fonts = {
  regular: 'Lato_400Regular',
  bold: 'Lato_700Bold',
  black: 'Lato_900Black',
  display: 'BebasNeue_400Regular',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 14, xl: 18, pill: 999 };

// Spring presets: snappy for presses, softer for layout moves.
export const springs = {
  press: { damping: 18, stiffness: 420, mass: 0.6 },
  soft: { damping: 20, stiffness: 180 },
  bouncy: { damping: 10, stiffness: 260 },
};
