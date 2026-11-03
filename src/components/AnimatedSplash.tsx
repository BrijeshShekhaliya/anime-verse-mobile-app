import MaskedViewBase from '@react-native-masked-view/masked-view';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { Image as RNImage, StyleSheet, View, useWindowDimensions } from 'react-native';
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
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SEARCH_BUTTON } from './TopBar';
import { splashStage } from '@/lib/splash';
import { colors } from '@/lib/theme';

// The package's types predate React 19's; the component itself works as usual.
const MaskedView = MaskedViewBase as unknown as ComponentType<{ maskElement: ReactElement; children: ReactNode; style?: object }>;

const LOGO = require('../../assets/logo.png');
const SIZE = 168; // the logo while it plays
const HEADER_LOGO = 40; // the logo in Home's header (see TopBar / Brand)
const FIRE = '#FF640A';
const INTRO_MS = 1250;

// Takes over from the phone's splash screen (same black, same logo) and brings
// the logo to life: it winds up and pops in, energy rings burst out behind it,
// and a light sweeps across it. Once the app is ready the logo flies into its
// place in Home's header (a shared-element hand-off: the header's own logo
// appears exactly where this one lands), while the screen fades in around it.
// On first launch (welcome tour) it zooms through instead.
// Everything runs on the UI thread with transforms and opacity only.
export function AnimatedSplash({ ready, toHeader, onDone }: { ready: boolean; toHeader: boolean; onDone: () => void }) {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [area, setArea] = useState({ w: win.width, h: win.height });
  const [introDone, setIntroDone] = useState(false);

  const pop = useSharedValue(reduce ? 1 : 0.5);
  const turn = useSharedValue(reduce ? 0 : -12);
  const glow = useSharedValue(0);
  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);
  const shine = useSharedValue(0);
  const breathe = useSharedValue(0);
  const fly = useSharedValue(0);
  const zoom = useSharedValue(0);
  const bg = useSharedValue(1);

  // Hand over from the native splash once our logo is on screen (a second at
  // most, in case the picture is slow to draw).
  const handedOver = useRef(false);
  const handOver = () => {
    if (handedOver.current) return;
    handedOver.current = true;
    SplashScreen.hideAsync().catch(() => {});
    if (reduce) {
      setIntroDone(true);
      return;
    }
    const ease = Easing.out(Easing.cubic);
    pop.value = withSequence(withTiming(0.86, { duration: 200, easing: Easing.inOut(Easing.quad) }), withSpring(1, { damping: 9, stiffness: 150, mass: 0.8 }));
    turn.value = withDelay(200, withSpring(0, { damping: 10, stiffness: 120 }));
    glow.value = withDelay(200, withSequence(withTiming(1, { duration: 260 }), withTiming(0.45, { duration: 600 })));
    ring1.value = withDelay(240, withTiming(1, { duration: 800, easing: ease }));
    ring2.value = withDelay(460, withTiming(1, { duration: 800, easing: ease }));
    shine.value = withDelay(560, withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }));
    setTimeout(() => setIntroDone(true), INTRO_MS);
  };
  useEffect(() => {
    const t = setTimeout(handOver, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Still loading after the intro: the logo breathes and glows gently.
  useEffect(() => {
    if (!introDone || ready || reduce) return;
    breathe.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(breathe);
  }, [introDone, ready, reduce, breathe]);

  // Exit: fly into the header (or zoom through to the welcome tour).
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!introDone || !ready || leaving) return;
    setLeaving(true);
    cancelAnimation(breathe);
    breathe.value = withTiming(0, { duration: 160 });
    glow.value = withTiming(0, { duration: 300 });
    const finish = () => {
      splashStage.value = withTiming(2, { duration: 420, easing: Easing.out(Easing.cubic) });
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
      bg.value = withDelay(140, withTiming(0, { duration: 440, easing: Easing.out(Easing.quad) }));
      fly.value = withTiming(1, { duration: 640, easing: Easing.bezier(0.65, 0, 0.35, 1) }, (done) => {
        if (!done) return;
        splashStage.value = 1; // the header's logo takes over in the same spot
        runOnJS(finish)();
      });
    } else {
      bg.value = withDelay(120, withTiming(0, { duration: 380 }));
      zoom.value = withTiming(1, { duration: 480, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(finish)();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introDone, ready]);

  // Header logo centre, relative to the screen's centre.
  const dx = SEARCH_BUTTON.right + HEADER_LOGO / 2 - area.w / 2;
  const dy = insets.top + SEARCH_BUTTON.barHeight / 2 - area.h / 2;
  const end = HEADER_LOGO / SIZE;

  const bgStyle = useAnimatedStyle(() => ({ opacity: bg.value }));
  const logoStyle = useAnimatedStyle(() => {
    const s = pop.value * (1 + breathe.value * 0.04) * interpolate(fly.value, [0, 1], [1, end]) * interpolate(zoom.value, [0, 1], [1, 1.7]);
    return {
      opacity: interpolate(zoom.value, [0, 0.8], [1, 0], 'clamp') * interpolate(pop.value, [0.5, 0.8], [0, 1], 'clamp'),
      transform: [{ translateX: fly.value * dx }, { translateY: fly.value * dy }, { scale: s }, { rotate: `${turn.value}deg` }],
    };
  });
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value * (0.8 + breathe.value * 0.2) * (1 - fly.value),
    transform: [{ scale: 1 + breathe.value * 0.08 }],
  }));
  const ring1Style = useAnimatedStyle(() => ({
    opacity: interpolate(ring1.value, [0, 0.15, 1], [0, 0.8, 0]),
    transform: [{ scale: interpolate(ring1.value, [0, 1], [0.7, 2.6]) }],
  }));
  const ring2Style = useAnimatedStyle(() => ({
    opacity: interpolate(ring2.value, [0, 0.15, 1], [0, 0.8, 0]),
    transform: [{ scale: interpolate(ring2.value, [0, 1], [0.7, 2.6]) }],
  }));
  const shineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shine.value, [0, 0.1, 0.9, 1], [0, 1, 1, 0]),
    transform: [{ translateX: interpolate(shine.value, [0, 1], [-SIZE, SIZE]) }, { rotate: '20deg' }],
  }));

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={leaving ? 'none' : 'auto'}
      onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.bg, bgStyle]} />
      <View style={styles.center} pointerEvents="none">
        <Animated.View style={[styles.glow, glowStyle]} />
        <Animated.View style={[styles.ring, ring1Style]} />
        <Animated.View style={[styles.ring, ring2Style]} />
        <Animated.View style={[styles.logo, logoStyle]}>
          <Image source={LOGO} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory" onDisplay={handOver} />
          {/* A light sweeping across the logo (only where the logo is drawn). */}
          {reduce ? null : (
            <MaskedView style={StyleSheet.absoluteFill} maskElement={<RNImage source={LOGO} style={styles.mask} resizeMode="contain" />}>
              <Animated.View style={[styles.shine, shineStyle]}>
                <LinearGradient
                  colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            </MaskedView>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: colors.bg },
  center: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  logo: { width: SIZE, height: SIZE },
  mask: { width: SIZE, height: SIZE },
  glow: { position: 'absolute', width: SIZE * 1.15, height: SIZE * 1.15, borderRadius: SIZE, backgroundColor: 'rgba(255,100,10,0.22)' },
  ring: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE, borderWidth: 2, borderColor: FIRE },
  shine: { position: 'absolute', top: -SIZE * 0.2, width: SIZE * 0.45, height: SIZE * 1.4, left: SIZE * 0.275 },
});
