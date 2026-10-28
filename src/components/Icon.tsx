// The website's custom icon set (soft filled shapes with a duotone layer),
// ported to react-native-svg so the app looks like the same product.
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

export type IconName =
  | 'play' | 'info' | 'star' | 'left' | 'right' | 'down' | 'search' | 'home' | 'browse' | 'calendar'
  | 'bookmark' | 'bookmarkOn' | 'clock' | 'x' | 'check' | 'mic' | 'cc' | 'ext' | 'shield' | 'plus'
  | 'minus' | 'trash' | 'spark' | 'history' | 'list';

type Props = { name: IconName; size?: number; color?: string; strokeWidth?: number };

export function Icon({ name, size = 22, color = '#fff', strokeWidth = 2 }: Props) {
  const s = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const solid = { fill: color };
  const tint = { fill: color, opacity: 0.2 };
  let body: React.ReactNode = null;
  switch (name) {
    case 'play':
      body = <Path {...solid} d="M8 5.6v12.8c0 .9 1 1.5 1.8 1l10-6.4c.7-.5.7-1.5 0-2l-10-6.4C9 4.1 8 4.7 8 5.6z" />;
      break;
    case 'info':
      body = (
        <>
          <Rect {...tint} x="3" y="3" width="18" height="18" rx="6" />
          <Rect {...s} x="3" y="3" width="18" height="18" rx="6" />
          <Path {...s} d="M12 11.5v5" />
          <Circle {...solid} cx="12" cy="7.8" r="1.3" />
        </>
      );
      break;
    case 'star':
      body = <Path {...solid} d="M12 2.8c.4 0 .7.2.9.6l2.3 4.7 5.1.8c.8.1 1.1 1.1.5 1.7l-3.7 3.6.9 5.1c.1.8-.7 1.4-1.4 1l-4.6-2.4-4.6 2.4c-.7.4-1.6-.2-1.4-1l.9-5.1-3.7-3.6c-.6-.6-.3-1.6.5-1.7l5.1-.8 2.3-4.7c.2-.4.5-.6.9-.6z" />;
      break;
    case 'left':
      body = <Path {...s} strokeWidth={2.6} d="M14.5 6.5L9 12l5.5 5.5" />;
      break;
    case 'right':
      body = <Path {...s} strokeWidth={2.6} d="M9.5 6.5L15 12l-5.5 5.5" />;
      break;
    case 'down':
      body = <Path {...s} strokeWidth={2.4} d="M7 10l5 4.5 5-4.5" />;
      break;
    case 'search':
      body = (
        <>
          <Circle {...tint} cx="10.5" cy="10.5" r="7" />
          <Circle {...s} cx="10.5" cy="10.5" r="7" />
          <Path {...s} strokeWidth={2.8} d="M16 16l4.5 4.5" />
        </>
      );
      break;
    case 'home':
      body = (
        <>
          <Path {...tint} d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 19z" />
          <Path {...s} d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 19z" />
          <Path {...s} d="M9.5 20.5v-5h5v5" />
        </>
      );
      break;
    case 'browse':
      body = (
        <>
          <Rect {...tint} x="3.5" y="3.5" width="7" height="7" rx="2.2" />
          <Rect {...s} x="3.5" y="3.5" width="7" height="7" rx="2.2" />
          <Rect {...s} x="13.5" y="3.5" width="7" height="7" rx="2.2" />
          <Rect {...s} x="3.5" y="13.5" width="7" height="7" rx="2.2" />
          <Circle {...s} cx="17" cy="17" r="3.5" />
        </>
      );
      break;
    case 'calendar':
      body = (
        <>
          <Rect {...tint} x="3.5" y="5" width="17" height="15.5" rx="4" />
          <Rect {...s} x="3.5" y="5" width="17" height="15.5" rx="4" />
          <Path {...s} d="M8 3v4M16 3v4M3.5 10h17" />
          <Circle {...solid} cx="12" cy="15" r="1.4" />
        </>
      );
      break;
    case 'bookmark':
      body = <Path {...s} d="M6.5 4.5h11a1 1 0 011 1v15l-6.5-4-6.5 4v-15a1 1 0 011-1z" />;
      break;
    case 'bookmarkOn':
      body = <Path {...solid} d="M6.5 4.5h11a1 1 0 011 1v15l-6.5-4-6.5 4v-15a1 1 0 011-1z" />;
      break;
    case 'list':
      body = (
        <>
          <Path {...tint} d="M6.5 4.5h11a1 1 0 011 1v15l-6.5-4-6.5 4v-15a1 1 0 011-1z" />
          <Path {...s} d="M6.5 4.5h11a1 1 0 011 1v15l-6.5-4-6.5 4v-15a1 1 0 011-1z" />
        </>
      );
      break;
    case 'clock':
      body = (
        <>
          <Circle {...tint} cx="12" cy="12" r="9.5" />
          <Circle {...s} cx="12" cy="12" r="9.5" />
          <Path {...s} d="M12 7v5.2l3.2 2" />
        </>
      );
      break;
    case 'history':
      body = (
        <>
          <Path {...s} d="M4 12a8 8 0 102.4-5.7" />
          <Path {...s} d="M4 4.5v4h4" />
          <Path {...s} d="M12 8v4.5l3 1.8" />
        </>
      );
      break;
    case 'x':
      body = <Path {...s} strokeWidth={2.4} d="M7 7l10 10M17 7L7 17" />;
      break;
    case 'check':
      body = <Path {...s} strokeWidth={2.8} d="M5 12.5l4.2 4.2L19 7" />;
      break;
    case 'plus':
      body = <Path {...s} strokeWidth={2.6} d="M12 5v14M5 12h14" />;
      break;
    case 'minus':
      body = <Path {...s} strokeWidth={2.6} d="M5 12h14" />;
      break;
    case 'trash':
      body = <Path {...s} d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7" />;
      break;
    case 'mic':
      body = (
        <>
          <Rect {...tint} x="8" y="2.5" width="8" height="12.5" rx="4" />
          <Rect {...s} x="8" y="2.5" width="8" height="12.5" rx="4" />
          <Path {...s} d="M4.5 11.5a7.5 7.5 0 0015 0M12 19v2.5" />
        </>
      );
      break;
    case 'cc':
      body = (
        <>
          <Rect {...tint} x="2.5" y="4.5" width="19" height="15" rx="5" />
          <Rect {...s} x="2.5" y="4.5" width="19" height="15" rx="5" />
          <Path {...s} d="M10.5 10.2a2.2 2.2 0 100 3.6M16.5 10.2a2.2 2.2 0 100 3.6" />
        </>
      );
      break;
    case 'ext':
      body = (
        <>
          <Path {...s} d="M13 3.5h7.5V11M20.5 3.5L11 13" />
          <Path {...s} d="M17.5 14v2.5a4 4 0 01-4 4h-6a4 4 0 01-4-4v-6a4 4 0 014-4H10" />
        </>
      );
      break;
    case 'shield':
      body = (
        <>
          <Path {...tint} d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V5.8z" />
          <Path {...s} d="M12 2.8l7.5 3v5.6c0 4.6-3.1 8.4-7.5 9.8-4.4-1.4-7.5-5.2-7.5-9.8V5.8z" />
        </>
      );
      break;
    case 'spark':
      body = <Path {...solid} d="M12 2l2.2 6.3L20.5 10.5l-6.3 2.2L12 19l-2.2-6.3L3.5 10.5l6.3-2.2z" />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

// The AnimeVerse logo mark: crescent and sparkle on the orange-pink gradient.
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Defs>
        <LinearGradient id="av" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#ff8a3d" />
          <Stop offset="1" stopColor="#ff3d6e" />
        </LinearGradient>
      </Defs>
      <Rect width="32" height="32" rx="9" fill="url(#av)" />
      <Path d="M17.6 7.2a9.2 9.2 0 1 0 7.6 14.4 10.4 10.4 0 0 1-7.6-14.4z" fill="#fff" />
      <Path d="M22.6 5.5l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" fill="#fff" />
    </Svg>
  );
}
