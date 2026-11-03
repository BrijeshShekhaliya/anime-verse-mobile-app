import MaskedViewBase from '@react-native-masked-view/masked-view';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import { memo, useEffect, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { Image as RNImage, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BRAND_LOGO, BrandWord, brandGap } from './Brand';
import { SEARCH_BUTTON } from './TopBar';
import { loadLaunchSound } from '@/lib/settings';
import { splashStage } from '@/lib/splash';
import { colors } from '@/lib/theme';

// The package's types predate React 19's; the component itself works as usual.
const MaskedView = MaskedViewBase as unknown as ComponentType<{ maskElement: ReactElement; children: ReactNode; style?: object }>;

const LAUNCH_SOUND = require('../../assets/sounds/launch_sound.mp3');

// The splash builds the same lockup as Home's header (logo + ANIME VERSE),
// at K times its size; flying to the header it shrinks by exactly K, so it
// lands as a perfect match for the header's own lockup.
const HEADER = 40; // Brand size in Home's header (see TopBar)
const K = 1.6;
const BIG = HEADER * K; // 64
const SOLO = 1.75; // the logo on its own is shown this much bigger, centred
const ORBIT_R = BIG * SOLO * 0.62; // the ring of light around it
const FIRE = '#FF640A';
const GOLD = '#FFC15E';

// Timeline in ms.
const GATHER = 550; // embers drift in while a ring of light draws itself
const ORBIT_FROM = 100;
const BLOOM = 550; // the logo blooms in (bell chord)
const FORM = 800; // the logo glides aside and the name unfolds beside it (twinkle)
const FORM_MS = 500;
const SHINE = 1150; // light passes across the lockup
const INTRO_MS = 1500;

// Deterministic "random" layout (same every launch).
const rand = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const EMBERS = Array.from({ length: 22 }, (_, i) => ({
  angle: (i / 22) * 360 + rand(i, 1) * 15,
  from: 0.38 + rand(i, 2) * 0.45, // start distance, as a share of the screen's half-diagonal
  size: 2 + rand(i, 3) * 3,
  spin: 30 + rand(i, 4) * 40, // how far it curls round while drifting in
  lag: rand(i, 5) * 0.3, // some arrive a little later than others
  color: i % 3 === 0 ? '#FFFFFF' : i % 3 === 1 ? GOLD : FIRE,
}));
const DOTS = 40;

// The app's opening, with no sound.
// The phone's splash is plain black, so the screen starts dark. Warm embers
// drift in and a ring of light draws itself; the logo then blooms in at the
// centre inside a soft glow. Then the logo glides aside and "ANIME
// VERSE" unfolds beside it, forming the header's lockup, and a light passes
// across it. Once the app is ready the whole lockup glides up into Home's
// header and lands exactly on the header's own (a shared-element hand-off).
// On first launch it drifts forward into the welcome tour instead.
// Transforms and opacity only, on the UI thread. "Reduce motion" gets a plain fade.
export function AnimatedSplash({ ready, toHeader, fontsReady, onDone }: { ready: boolean; toHeader: boolean; fontsReady: boolean; onDone: () => void }) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [area, setArea] = useState({ w: win.width, h: win.height });
  const [rowW, setRowW] = useState(BIG * 5); // the lockup's width, measured below
  const [introDone, setIntroDone] = useState(false);
  // The masked light only exists while it sweeps across the lockup, so the
  // expensive mask isn't drawn during the start or the hand-off.
  const [shineOn, setShineOn] = useState(false);
  const R = Math.hypot(area.w, area.h) / 2;

  const launchSound = useAudioPlayer(LAUNCH_SOUND);
  const soundOn = useRef(false);

  const bloom = useSharedValue(0);
  const form = useSharedValue(0);
  const gather = useSharedValue(0);
  const drift = useSharedValue(0);
  const orbit = useSharedValue(0);
  const ripple = useSharedValue(0);
  const glow = useSharedValue(0);
  const shine = useSharedValue(0);
  const breathe = useSharedValue(0);
  const fly = useSharedValue(0);
  const zoom = useSharedValue(0);
  const bg = useSharedValue(1);

  // Starts once the screen is drawn.
  const started = useRef(false);
  const drawn = useRef(false);
  const soundKnown = useRef(false);
  const start = () => {
    if (started.current) return;
    started.current = true;
    SplashScreen.hideAsync().catch(() => {});
    if (reduce) {
      bloom.value = withTiming(1, { duration: 250 });
      form.value = 1;
      setIntroDone(true);
      return;
    }
    if (soundOn.current) {
      // The file may still be loading; play as soon as it is ready.
      const playNow = () => {
        try {
          launchSound.seekTo(0);
          launchSound.play();
        } catch {}
      };
      if (launchSound.isLoaded) playNow();
      else {
        const sub = launchSound.addListener('playbackStatusUpdate', (s) => {
          if (s.isLoaded) {
            sub.remove();
            playNow();
          }
        });
      }
    }
    if (Platform.OS !== 'web') setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {}), BLOOM);

    const soft = Easing.bezier(0.45, 0, 0.2, 1);
    gather.value = withTiming(1, { duration: GATHER, easing: soft });
    orbit.value = withDelay(ORBIT_FROM, withTiming(1, { duration: BLOOM - ORBIT_FROM, easing: Easing.inOut(Easing.quad) }));
    bloom.value = withDelay(BLOOM, withSpring(1, { damping: 18, stiffness: 120, mass: 0.9 }));
    glow.value = withDelay(BLOOM - 100, withTiming(1, { duration: 350, easing: Easing.out(Easing.quad) }));
    ripple.value = withDelay(BLOOM, withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
    drift.value = withDelay(BLOOM, withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }));
    form.value = withDelay(FORM, withTiming(1, { duration: FORM_MS, easing: Easing.bezier(0.5, 0, 0.15, 1) }));
    shine.value = withDelay(SHINE, withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) }));
    setTimeout(() => setShineOn(true), SHINE);
    setTimeout(() => setShineOn(false), SHINE + 600);
    setTimeout(() => setIntroDone(true), INTRO_MS);
  };
  // Starts once the screen is drawn and the sound setting is known.
  const tryStart = () => {
    if (drawn.current && soundKnown.current) start();
  };

  // Sound: on unless turned off in Settings, mixed with any music already playing.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
    loadLaunchSound()
      .then((on) => {
        soundOn.current = on && !reduce;
      })
      .catch(() => {})
      .finally(() => {
        soundKnown.current = true;
        tryStart();
      });
    // Never hold the launch: start within a second even if the layout hasn't reported.
    const t = setTimeout(() => {
      drawn.current = true;
      soundKnown.current = true;
      start();
    }, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Still loading after the intro: the lockup breathes and its glow pulses softly.
  useEffect(() => {
    if (!introDone || ready || reduce) return;
    breathe.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(breathe);
  }, [introDone, ready, reduce, breathe]);

  // Exit: the lockup glides into the header (or drifts forward into the tour).
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!introDone || !ready || leaving) return;
    setLeaving(true);
    cancelAnimation(breathe);
    breathe.value = withTiming(0, { duration: 200 });
    glow.value = withTiming(0, { duration: 400 });
    const finish = () => {
      splashStage.value = 2;
      onDone();
    };
    if (reduce) {
      splashStage.value = 2;
      bg.value = withTiming(0, { duration: 250 }, (done) => {
        if (done) runOnJS(onDone)();
      });
      zoom.value = withTiming(1, { duration: 250 });
      return;
    }
    if (toHeader) {
      bg.value = withDelay(100, withTiming(0, { duration: 350, easing: Easing.out(Easing.quad) }));
      fly.value = withTiming(1, { duration: 500, easing: Easing.bezier(0.55, 0, 0.2, 1) }, (done) => {
        if (!done) return;
        splashStage.value = 1; // the header's lockup takes over in the same spot
        runOnJS(finish)();
      });
    } else {
      bg.value = withDelay(100, withTiming(0, { duration: 350 }));
      zoom.value = withTiming(1, { duration: 400, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(finish)();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introDone, ready]);

  // Where the header's lockup sits, relative to the screen's centre.
  const dx = SEARCH_BUTTON.right + rowW / K / 2 - area.w / 2;
  const dy = insets.top + SEARCH_BUTTON.barHeight / 2 - area.h / 2;
  // While on its own, the logo sits in the middle of the screen, not at the
  // lockup's left end.
  const soloShift = rowW / 2 - BIG / 2;

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }));
  const lockupStyle = useAnimatedStyle(() => ({
    opacity: interpolate(zoom.value, [0, 0.9], [1, 0], 'clamp'),
    transform: [
      { translateX: fly.value * dx },
      { translateY: fly.value * dy },
      { scale: (1 + breathe.value * 0.025) * interpolate(fly.value, [0, 1], [1, 1 / K]) * interpolate(zoom.value, [0, 1], [1, 1.3]) },
    ],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: interpolate(bloom.value, [0, 0.6], [0, 1], 'clamp'),
    transform: [
      { translateX: (1 - form.value) * soloShift },
      { scale: interpolate(bloom.value, [0, 1], [0.82, 1]) * interpolate(form.value, [0, 1], [SOLO, 1]) },
    ],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: interpolate(form.value, [0.2, 0.85], [0, 1], 'clamp'),
    transform: [{ translateX: interpolate(form.value, [0, 1], [-36, 0]) }, { scale: interpolate(form.value, [0, 1], [0.94, 1]) }],
  }));
  // The glow only fades in and out; it no longer pulses in size, so its edge stays soft.
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * (0.85 + breathe.value * 0.15) * (1 - fly.value),
    transform: [{ scale: interpolate(glow.value, [0, 1], [0.8, 1]) }],
  }));
  const orbitStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ripple.value, [0, 1], [1, 0]),
    transform: [{ scale: interpolate(ripple.value, [0, 1], [1, 1.8]) }, { rotate: `${orbit.value * 40 + ripple.value * 25}deg` }],
  }));
  const shineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shine.value, [0, 0.12, 0.88, 1], [0, 1, 1, 0]),
    transform: [{ translateX: interpolate(shine.value, [0, 1], [-BIG, rowW + BIG]) }, { rotate: '18deg' }],
  }));

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={leaving ? 'none' : 'auto'}
      onLayout={(e) => {
        setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
        drawn.current = true;
        tryStart();
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.bg, bgStyle]} />
      <View style={styles.center} pointerEvents="none">
        {/* Embers and the ring of light, drawn from the centre. */}
        <View style={styles.anchor}>
          {EMBERS.map((e, i) => (
            <Ember key={i} {...e} R={R} gather={gather} drift={drift} />
          ))}
        </View>
        <Animated.View style={[styles.anchor, orbitStyle]}>
          {Array.from({ length: DOTS }, (_, i) => (
            <OrbitDot key={i} i={i} orbit={orbit} />
          ))}
        </Animated.View>

        {/* The lockup: the same layout as the header's, K times bigger. */}
        <Animated.View style={lockupStyle}>
          <View style={[styles.row, { gap: brandGap(BIG) }]} onLayout={(e) => setRowW(e.nativeEvent.layout.width)}>
            {fontsReady ? (
              <Animated.View style={wordStyle}>
                <BrandWord size={BIG} />
              </Animated.View>
            ) : (
              <View />
            )}
            <Animated.View style={[styles.logo, logoStyle]}>
              <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none">
                <Svg width={BIG * 2.4} height={BIG * 2.4}>
                  <Defs>
                    <RadialGradient id="splashGlow" cx="50%" cy="50%" rx="50%" ry="50%" fx="50%" fy="50%" gradientUnits="userSpaceOnUse">
                      <Stop offset="0" stopColor="#FF8C28" stopOpacity="0.32" />
                      <Stop offset="0.35" stopColor="#FF640A" stopOpacity="0.16" />
                      <Stop offset="0.7" stopColor="#FF640A" stopOpacity="0.04" />
                      <Stop offset="1" stopColor="#FF640A" stopOpacity="0" />
                    </RadialGradient>
                  </Defs>
                  <Circle cx={BIG * 1.2} cy={BIG * 1.2} r={BIG * 1.2} fill="url(#splashGlow)" />
                </Svg>
              </Animated.View>
              <Image source={BRAND_LOGO} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory" allowDownscaling={false} />
            </Animated.View>
          </View>
          {/* A light passing across the whole lockup. */}
          {reduce || !shineOn ? null : (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <MaskedView style={StyleSheet.absoluteFill} maskElement={<LockupMask fontsReady={fontsReady} />}>
                <Animated.View style={[styles.shine, shineStyle]}>
                  <LinearGradient
                    colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              </MaskedView>
            </View>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

// The lockup's shape (logo + wordmark), used to keep the passing light on it.
function LockupMask({ fontsReady }: { fontsReady: boolean }) {
  return (
    <View style={[styles.row, styles.maskRow, { gap: brandGap(BIG) }]}>
      <RNImage source={BRAND_LOGO} style={{ width: BIG, height: BIG }} resizeMode="contain" />
      {fontsReady ? <BrandWord size={BIG} /> : null}
    </View>
  );
}

// A warm ember: drifts in from the dark, curling round to the ring, then
// floats away softly after the bloom.
const Ember = memo(function Ember({
  angle,
  from,
  size,
  spin,
  lag,
  color,
  R,
  gather,
  drift,
}: (typeof EMBERS)[number] & { R: number; gather: SharedValue<number>; drift: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const g = interpolate(gather.value, [lag, 1], [0, 1], 'clamp');
    const r = interpolate(g, [0, 1], [R * from, ORBIT_R]) + drift.value * ORBIT_R * 0.8;
    return {
      opacity: interpolate(g, [0, 0.4], [0, 0.85], 'clamp') * (1 - drift.value),
      transform: [{ rotate: `${angle + g * spin + drift.value * 15}deg` }, { translateX: r }, { scale: 1 - drift.value * 0.5 }],
    };
  });
  return <Animated.View style={[styles.ember, { width: size, height: size, left: -size / 2, top: -size / 2, borderRadius: size, backgroundColor: color }, style]} />;
});

// One point of the ring of light: they light up in turn around the circle.
const OrbitDot = memo(function OrbitDot({ i, orbit }: { i: number; orbit: SharedValue<number> }) {
  const at = i / DOTS;
  const angle = at * 360 - 90;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(orbit.value, [at, at + 0.1], [0, 1], 'clamp') * (i % 2 === 0 ? 0.9 : 0.5),
    transform: [{ rotate: `${angle}deg` }, { translateX: ORBIT_R }, { scale: interpolate(orbit.value, [at, at + 0.1], [1.8, 1], 'clamp') }],
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: i % 5 === 0 ? GOLD : i % 2 === 0 ? '#FFFFFF' : FIRE }, style]} />;
});

const styles = StyleSheet.create({
  bg: { backgroundColor: colors.bg },
  center: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  anchor: { position: 'absolute', width: 0, height: 0 },
  ember: { position: 'absolute' },
  dot: { position: 'absolute', width: 3, height: 3, left: -1.5, top: -1.5, borderRadius: 2 },
  // The logo is drawn after the wordmark (on top of it while the name unfolds
  // from behind it), but placed first in the row, like the header's lockup.
  row: { flexDirection: 'row-reverse', alignItems: 'center' },
  maskRow: { flexDirection: 'row' },
  logo: { width: BIG, height: BIG, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: BIG * 2.4, height: BIG * 2.4, alignItems: 'center', justifyContent: 'center' },
  shine: { position: 'absolute', top: -BIG * 0.4, width: BIG * 0.6, height: BIG * 1.8, left: 0 },
});
