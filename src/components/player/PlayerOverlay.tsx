import * as Brightness from 'expo-brightness';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, usePinchGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  type SharedValue,
  interpolate,
  measure,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedProps,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { systemVolume } from 'native-media3-player';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { colors, fonts } from '@/lib/theme';
import { MINI_MENU_WIDTH, PLAYER_COLOURS, PlayerMiniMenu, QualityBadge } from './PlayerMiniMenu';
import type { SheetSection } from './PlayerSettingsSheet';
import type { ScreenShape } from '@/lib/screenShape';
import { clampZoom, fillZoom, fitTap, isZoomed, type FitMode } from '@/lib/videoZoom';

export type QuickChip = { key: string; icon: IconName; label: string; badge?: string | null };

type PinchFrom = { zoom: number; fill: number };

type Insets = { top: number; bottom: number; left: number; right: number };

type Props = {
  visible: boolean;
  locked: boolean; // a panel is open over the player: taps on the video do nothing
  failed: boolean; // nothing to play: only the top bar, and touches pass to what's underneath
  shape: ScreenShape;
  menuOpen: ScreenShape; // tells the video behind to blur while a selection menu is open
  title: string;
  subtitle: string;
  isPlaying: boolean;
  isBuffering: boolean;
  time: SharedValue<number>;
  buffered: SharedValue<number>;
  duration: number;
  volume: number;
  insets: Insets;
  chips: QuickChip[];
  menus: SheetSection[];
  hasNext: boolean;
  enhanced: boolean;
  onToggleEnhance: () => void;
  autoplay: boolean;
  onToggleAutoplay: () => void;
  fitMode: FitMode;
  zoom: SharedValue<number>; // the pinched size: 1 is the fit mode's own
  onZoomEnd: (zoom: number) => void;
  onControlsShown: () => void;
  onControlsHidden: () => void;
  onHoldControls: () => void;
  onKeepAlive: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onSeekBy: (delta: number) => void;
  onVolume: (volume: number) => void;
  onBack: () => void;
  onToggleFullscreen: () => void;
  onCycleFit: () => void;
  onOpenSettings: () => void;
  onNext: () => void;
};

// Two taps closer together than this, in about the same place, are a double-tap.
const DOUBLE_TAP_MS = 260;
// After a skip, every further tap on that side adds 10 s for this long.
const REPEAT_MS = 800;
// A pause shorter than this shows no spinner (a skip inside what's already loaded).
const SPINNER_DELAY_MS = 350;

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};
const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

// The player's controls and touch gestures, drawn over the video.
//  - Tap: show / hide the controls.
//  - Double-tap left / right: back / forward 10 s (keep tapping to add more);
//    double-tap the middle: play / pause.
//  - Drag up / down on the left half: screen brightness; right half: volume.
//  - Seek bar: drag or tap anywhere on it; a bubble shows the time.
// Touches are answered on the UI thread, so the controls appear in the same frame
// as the tap whatever else the app is doing. Showing never waits to see whether a
// second tap is coming: a double-tap simply keeps them up. Only hiding waits.
export const PlayerOverlay = memo(function PlayerOverlay(p: Props) {
  // Read directly, not through the watch screen, so the controls don't wait for it to re-render.
  const fullscreen = useSyncExternalStore(p.shape.subscribe, p.shape.get);
  useLayoutEffect(() => {
    if (__DEV__ && p.shape.changedAt()) console.log(`[Rotate] controls ready ${Date.now() - p.shape.changedAt()} ms after the tap`);
  }, [fullscreen, p.shape]);

  // ---- Controls fade ----
  const shown = useSharedValue(p.visible ? 1 : 0);
  const wanted = useSharedValue(p.visible);
  // Whether the buttons are really live. Trusting the fade alone could leave controls drawn
  // but switched off, which is a player that ignores every touch.
  const live = useSharedValue(p.visible);
  // They leave as the screen starts to turn, with no fade to watch them change shape in, and
  // stop taking touches at the same moment: the watch screen only hears of it later, and until
  // then its "visible" would leave invisible buttons to be pressed by accident.
  // An error's buttons stay: they are the only way out of it.
  const [turning, setTurning] = useState(false);
  const failedRef = useRef(p.failed);
  failedRef.current = p.failed;
  useEffect(
    () =>
      p.shape.subscribe(() => {
        if (failedRef.current) return;
        setTurning(true);
        wanted.value = false;
        live.value = false;
        shown.value = 0;
      }),
    [p.shape, wanted, live, shown]
  );
  useEffect(() => {
    if (p.visible) setTurning(false);
  }, [p.visible]);
  useEffect(() => {
    const next = p.visible;
    runOnUI(() => {
      'worklet';
      live.value = next;
      if (wanted.value === next) return;
      wanted.value = next;
      shown.value = withTiming(next ? 1 : 0, { duration: next ? 140 : 200, easing: Easing.out(Easing.quad) });
    })();
  }, [p.visible, shown, wanted, live]);
  const controlsStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const topStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(shown.value, [0, 1], [-8, 0]) }] }));
  const bottomStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(shown.value, [0, 1], [8, 0]) }] }));
  const centerStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(shown.value, [0, 1], [0.94, 1]) }] }));

  // ---- Where things are (for telling a tap on the video from a tap on a button) ----
  const surfaceW = useSharedValue(1);
  const surfaceH = useSharedValue(1);
  const topZone = useSharedValue(0);
  const bottomZone = useSharedValue(1e7);
  // What answers to a finger. The icons themselves are smaller, with nothing drawn around them.
  const skipSize = fullscreen ? 56 : 48;
  const playSize = fullscreen ? 64 : 56;
  const centerGap = fullscreen ? 44 : 22;
  const centerRow = useSharedValue({ playR: 0, skipR: 0, skipAt: 0 });
  useEffect(() => {
    centerRow.value = { playR: playSize / 2, skipR: skipSize / 2, skipAt: playSize / 2 + centerGap + skipSize / 2 };
  }, [playSize, skipSize, centerGap, centerRow]);

  // The video's gestures also see touches that land on the buttons drawn over it,
  // so they check here first and leave those alone.
  const onControl = (x: number, y: number) => {
    'worklet';
    if (y < topZone.value || y > bottomZone.value) return true;
    const g = centerRow.value;
    const dy = y - surfaceH.value / 2;
    const dx = Math.abs(x - surfaceW.value / 2);
    if (dx * dx + dy * dy <= (g.playR + 6) * (g.playR + 6)) return true;
    const sx = dx - g.skipAt;
    return sx * sx + dy * dy <= (g.skipR + 12) * (g.skipR + 12);
  };

  // A panel open over the video takes every tap.
  const blocked = useSharedValue(false);

  // ---- Quick menus (audio, subtitles, speed, quality) ----
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const chipX = useRef<Record<string, number>>({});
  const surfaceSize = useRef({ w: 0, h: 0 });
  const menuX = useRef(0);
  // Fullscreen's margins are fixed in advance. The phone's insets only reach here a second after
  // a turn, and following them made the controls jump into place late. The notch is the same
  // size whichever side it's on, so the largest inset seen so far already says how much room to leave.
  const notch = useRef(0);
  notch.current = Math.max(notch.current, p.insets.top, p.insets.left, p.insets.right);
  const sideGap = fullscreen ? Math.max(notch.current, 20) : 12;
  const bottomGap = fullscreen ? 26 : 10;
  const { onHoldControls, onKeepAlive, onControlsShown, onControlsHidden, onSeekBy, onTogglePlay, onVolume } = p;

  const openMenu = useCallback(
    (key: string) => {
      const left = sideGap + (chipX.current[key] ?? 0);
      // Menus only open in fullscreen, so the long side is the width, even if the layout event
      // from the turn hasn't arrived yet.
      const width = Math.max(surfaceSize.current.w, surfaceSize.current.h);
      menuX.current = Math.max(sideGap, Math.min(left, width - MINI_MENU_WIDTH - sideGap));
      setMenuKey(key);
      onHoldControls(); // the controls stay up while choosing
    },
    [sideGap, onHoldControls]
  );
  const closeMenu = useCallback(() => {
    setMenuKey(null);
    onKeepAlive();
  }, [onKeepAlive]);
  useEffect(() => {
    if (!fullscreen) setMenuKey(null);
  }, [fullscreen]);
  // Only a menu that's really there takes the taps.
  const menuIsOpen = !!menuKey && p.menus.some((m) => m.key === menuKey);
  useEffect(() => {
    blocked.value = p.locked || menuIsOpen;
    p.menuOpen.set(menuIsOpen || p.locked);
  }, [p.locked, menuIsOpen, blocked, p.menuOpen]);

  // ---- Brightness / volume drag ----
  const bright = useSharedValue(0.5);
  const vol = useSharedValue(systemVolume.get() ?? p.volume);
  const hudLevel = useSharedValue(0);
  const hudOpacity = useSharedValue(0);
  const dragKind = useSharedValue(0); // 1 brightness, 2 volume
  const dragStart = useSharedValue(0);
  const lastSent = useSharedValue(0);
  const [hudKind, setHudKind] = useState<1 | 2>(1);

  useEffect(() => {
    if (!systemVolume.available) vol.value = p.volume;
  }, [p.volume, vol]);
  // The side buttons may have changed it: read it fresh when a finger comes down.
  const readSystemVolume = useCallback(() => {
    const now = systemVolume.get();
    if (now != null) vol.value = now;
  }, [vol]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Brightness.getBrightnessAsync()
      .then((b) => (bright.value = b))
      .catch(() => {});
    // The phone's own brightness comes back when the player closes.
    return () => {
      Brightness.restoreSystemBrightnessAsync?.().catch(() => {});
    };
  }, [bright]);

  const applyLevel = useCallback(
    (kind: number, level: number) => {
      if (kind === 1) {
        if (Platform.OS !== 'web') Brightness.setBrightnessAsync(level).catch(() => {});
      } else if (systemVolume.available) systemVolume.set(level);
      else onVolume(level);
    },
    [onVolume]
  );

  const pan = usePanGesture({
    activeOffsetY: [-22, 22],
    failOffsetX: [-24, 24],
    maxPointers: 1,
    onBegin: () => {
      'worklet';
      runOnJS(readSystemVolume)();
    },
    onActivate: (e) => {
      'worklet';
      const startY = e.y - e.translationY;
      // Not from a screen edge (that's the phone's own gesture), a button, or under a panel.
      if (blocked.value || startY < 30 || startY > surfaceH.value - 30 || (wanted.value && live.value && onControl(e.x, startY))) return;
      const kind = e.x < surfaceW.value / 2 ? 1 : 2;
      dragKind.value = kind;
      dragStart.value = kind === 1 ? bright.value : vol.value;
      hudLevel.value = dragStart.value;
      hudOpacity.value = withTiming(1, { duration: 120 });
      runOnJS(setHudKind)(kind as 1 | 2);
    },
    onUpdate: (e) => {
      'worklet';
      if (!dragKind.value) return;
      const level = clamp01(dragStart.value - e.translationY / (surfaceH.value * 0.8));
      hudLevel.value = level;
      if (dragKind.value === 1) bright.value = level;
      else vol.value = level;
      const now = Date.now();
      if (now - lastSent.value > 80) {
        lastSent.value = now;
        runOnJS(applyLevel)(dragKind.value, level);
      }
    },
    onDeactivate: () => {
      'worklet';
      if (dragKind.value) runOnJS(applyLevel)(dragKind.value, hudLevel.value);
      dragKind.value = 0;
      hudOpacity.value = withDelay(500, withTiming(0, { duration: 250 }));
    },
  });

  // ---- Skipping ----
  // The feedback stays on the button: its arrow turns a little and a small "+10"
  // fades in beside it. Quick repeats add up ("+30"), from double-taps or the button.
  const backTurn = useSharedValue(0);
  const forwardTurn = useSharedValue(0);
  const backPop = useSharedValue(0);
  const forwardPop = useSharedValue(0);
  const [backTotal, setBackTotal] = useState(10);
  const [forwardTotal, setForwardTotal] = useState(10);
  const lastSkip = useRef({ side: 0, at: 0, total: 0 });

  const skip = useCallback(
    (side: -1 | 1) => {
      const now = Date.now();
      const l = lastSkip.current;
      const total = l.side === side && now - l.at < 900 ? l.total + 10 : 10;
      lastSkip.current = { side, at: now, total };
      onSeekBy(side * 10);
      onKeepAlive(); // the controls stay up while skipping
      (side < 0 ? setBackTotal : setForwardTotal)(total);
      const turn = side < 0 ? backTurn : forwardTurn;
      const pop = side < 0 ? backPop : forwardPop;
      turn.value = withSequence(withTiming(side * 32, { duration: 90, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 13, stiffness: 200 }));
      pop.value = withSequence(withTiming(1, { duration: 90 }), withDelay(480, withTiming(0, { duration: 200 })));
    },
    [onSeekBy, onKeepAlive, backTurn, forwardTurn, backPop, forwardPop]
  );

  const onDoubleTap = useCallback(
    (zone: number) => {
      if (zone === 0) onTogglePlay();
      else skip(zone as -1 | 1);
    },
    [onTogglePlay, skip]
  );

  // ---- Taps ----
  const lastTapAt = useSharedValue(0);
  const lastTapX = useSharedValue(0);
  const repeatUntil = useSharedValue(0);
  const repeatSide = useSharedValue(0);
  const tellShown = useCallback(() => {
    setTurning(false);
    onControlsShown();
  }, [onControlsShown]);
  const tellHidden = useCallback(() => onControlsHidden(), [onControlsHidden]);

  const tap = useTapGesture({
    maxDuration: 400,
    maxDistance: 16,
    onActivate: (e) => {
      'worklet';
      const showing = wanted.value && live.value;
      if (blocked.value || (showing && onControl(e.x, e.y))) return;
      const now = Date.now();
      const w = surfaceW.value;
      const zone = e.x < w * 0.36 ? -1 : e.x > w * 0.64 ? 1 : 0;
      const isRepeat = zone !== 0 && zone === repeatSide.value && now < repeatUntil.value;
      const isSecond = now - lastTapAt.value < DOUBLE_TAP_MS && Math.abs(e.x - lastTapX.value) < 70;
      if (isRepeat || isSecond) {
        // A double-tap: the controls stay up (this also calls off a hide just begun).
        lastTapAt.value = 0;
        wanted.value = true;
        live.value = true;
        shown.value = withTiming(1, { duration: 120 });
        repeatSide.value = zone;
        repeatUntil.value = now + REPEAT_MS;
        runOnJS(tellShown)();
        runOnJS(onDoubleTap)(zone);
        return;
      }
      lastTapAt.value = now;
      lastTapX.value = e.x;
      if (showing) {
        wanted.value = false;
        shown.value = withDelay(
          DOUBLE_TAP_MS,
          withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) }, (done) => {
            if (done) runOnJS(tellHidden)();
          })
        );
      } else {
        wanted.value = true;
        live.value = true;
        shown.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
        runOnJS(tellShown)();
      }
    },
  });
  // ---- Pinch: the video's size, to the percent, in fullscreen ----
  const surfaceRef = useAnimatedRef<Animated.View>();
  const { zoom, onZoomEnd } = p;
  const pinchFrom = useSharedValue<PinchFrom>({ zoom: 1, fill: 0 });
  const pinching = useSharedValue(false);
  const badge = useSharedValue(0);
  const fitModeNow = useSharedValue<FitMode>(p.fitMode);
  const tick = useCallback(() => {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  }, []);
  const pinch = usePinchGesture({
    enabled: fullscreen && !p.failed,
    onActivate: () => {
      'worklet';
      if (blocked.value) return;
      const box = measure(surfaceRef);
      const w = box && box.width > 0 ? box.width : surfaceW.value;
      const h = box && box.height > 0 ? box.height : surfaceH.value;
      pinchFrom.value = { zoom: zoom.value, fill: fitModeNow.value === 'contain' ? fillZoom(w, h) : 0 };
      pinching.value = true;
      badge.value = withTiming(1, { duration: 120 });
      // The picture is what's being adjusted: nothing in the way.
      if (wanted.value) {
        wanted.value = false;
        shown.value = withTiming(0, { duration: 140 }, (done) => {
          if (done) runOnJS(tellHidden)();
        });
      }
    },
    onUpdate: (e) => {
      'worklet';
      if (!pinching.value) return;
      const from = pinchFrom.value;
      const next = clampZoom(from.zoom * e.scale);
      // A small tap under the fingers at the sizes worth stopping at.
      const before = zoom.value;
      if ((before - 1) * (next - 1) < 0 || (from.fill && (before - from.fill) * (next - from.fill) < 0)) runOnJS(tick)();
      zoom.value = next;
    },
    onDeactivate: () => {
      'worklet';
      if (!pinching.value) return;
      pinching.value = false;
      badge.value = withDelay(500, withTiming(0, { duration: 220 }));
      // Settles on a whole percent, so what's shown is exactly what's kept.
      const settled = Math.round(zoom.value * 100) / 100;
      zoom.value = settled;
      runOnJS(onZoomEnd)(settled);
    },
  });
  const resetZoom = useCallback(() => {
    zoom.value = withSpring(1, { damping: 20, stiffness: 220 });
    onZoomEnd(1);
  }, [zoom, onZoomEnd]);
  useEffect(() => {
    fitModeNow.value = p.fitMode;
  }, [p.fitMode, fitModeNow]);
  const { onCycleFit } = p;
  const pressFit = useCallback(() => {
    onKeepAlive();
    const action = fitTap(fitModeNow.value, isZoomed(zoom.value));
    if (action.reset) {
      resetZoom();
      return;
    }
    fitModeNow.value = action.mode; // the icon turns now, not after the screen has re-rendered
    onCycleFit();
  }, [fitModeNow, zoom, resetZoom, onCycleFit, onKeepAlive]);

  const gestures = useCompetingGestures(pinch, pan, tap);

  const hudStyle = useAnimatedStyle(() => ({ opacity: hudOpacity.value }));
  const hudFill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.001, hudLevel.value) }] }));

  // ---- Play button ----
  // 0 is the play triangle, 1 the pause bars. Turns at the tap, and the real state confirms it.
  const playShape = useSharedValue(p.isPlaying ? 1 : 0);
  const playPop = useSharedValue(1);
  const firstRender = useRef(true);
  useEffect(() => {
    playShape.value = withTiming(p.isPlaying ? 1 : 0, { duration: 180, easing: Easing.out(Easing.cubic) });
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    playPop.value = withSequence(withTiming(0.82, { duration: 70 }), withSpring(1, { damping: 12, stiffness: 260 }));
  }, [p.isPlaying, playPop, playShape]);
  const playIconStyle = useAnimatedStyle(() => ({ transform: [{ scale: playPop.value }] }));
  const { isPlaying } = p;
  const pressPlay = useCallback(() => {
    playShape.value = withTiming(isPlaying ? 0 : 1, { duration: 180, easing: Easing.out(Easing.cubic) });
    onTogglePlay();
  }, [isPlaying, onTogglePlay, playShape]);

  // One spinner at a time, and only for a pause long enough to notice.
  const waiting = p.isBuffering && p.isPlaying;
  const [spinner, setSpinner] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setSpinner(false);
      return;
    }
    const t = setTimeout(() => setSpinner(true), SPINNER_DELAY_MS);
    return () => clearTimeout(t);
  }, [waiting]);

  const menu = menuKey ? p.menus.find((m) => m.key === menuKey) : undefined;
  const menuChip = menuKey ? p.chips.find((c) => c.key === menuKey) : undefined;
  const [narrowRow, setNarrowRow] = useState(false);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Gesture surface (under the controls). */}
      <GestureDetector gesture={gestures}>
        <Animated.View
          ref={surfaceRef}
          style={StyleSheet.absoluteFill}
          pointerEvents={p.failed ? 'none' : 'auto'}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            surfaceW.value = width;
            surfaceH.value = height;
            surfaceSize.current = { w: width, h: height };
          }}
        />
      </GestureDetector>

      {spinner && !p.visible && !p.failed ? (
        <View style={[StyleSheet.absoluteFill, styles.spinnerWrap]} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : null}

      {/* The size while pinching. */}
      <ZoomBadge zoom={zoom} opacity={badge} from={pinchFrom} />

      {/* Brightness / volume level. */}
      <Animated.View pointerEvents="none" style={[styles.hud, hudStyle]}>
        <HudReadout kind={hudKind} level={hudLevel} fill={hudFill} />
      </Animated.View>

      {/* Controls. */}
      <Animated.View style={[StyleSheet.absoluteFill, controlsStyle, menuIsOpen && styles.behindMenu]} pointerEvents={p.visible && !turning ? 'box-none' : 'none'}>
        {p.failed ? null : <View style={styles.dim} pointerEvents="none" />}
        <LinearGradient colors={['rgba(0,0,0,0.75)', 'transparent']} style={styles.topScrim} pointerEvents="none" />
        {p.failed ? null : <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.bottomScrim} pointerEvents="none" />}

        {/* Top bar */}
        <Animated.View
          style={[styles.topBar, { paddingTop: fullscreen ? 16 : 8, paddingHorizontal: sideGap }, topStyle]}
          pointerEvents="box-none"
          onLayout={(e) => (topZone.value = e.nativeEvent.layout.height)}
        >
          <PressableScale onPress={p.onBack} style={styles.iconBtn} hitSlop={8} accessibilityLabel={fullscreen ? 'Exit fullscreen' : 'Back'}>
            <Icon name="left" size={24} color="#fff" />
          </PressableScale>
          <View style={styles.titleWrap} pointerEvents="none">
            <Text style={styles.title} numberOfLines={1}>
              {p.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {p.subtitle}
            </Text>
          </View>
          {p.failed || !fullscreen ? null : <AutoNextSwitch on={p.autoplay} onPress={p.onToggleAutoplay} />}
          {p.failed || !fullscreen ? null : <FitButton mode={fitModeNow} zoom={zoom} onPress={pressFit} />}
          {/* In fullscreen its options are all on the bottom row. */}
          {p.failed || fullscreen ? null : (
            <PressableScale onPress={p.onOpenSettings} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Player settings">
              <Icon name="settings" size={21} color="#fff" />
            </PressableScale>
          )}
        </Animated.View>

        {/* Centre */}
        {p.failed ? null : (
          <Animated.View style={[styles.center, { gap: centerGap }, centerStyle]} pointerEvents="box-none">
            <SkipButton dir={-1} size={skipSize} glyph={fullscreen ? 34 : 28} total={backTotal} turn={backTurn} pop={backPop} onPress={skip} />
            <PressableScale
              onPress={pressPlay}
              style={[styles.centerBtn, { width: playSize, height: playSize }]}
              scaleTo={0.86}
              accessibilityLabel={p.isPlaying ? 'Pause' : 'Play'}
            >
              {spinner ? (
                <ActivityIndicator size="large" color="#fff" />
              ) : (
                <Animated.View style={[styles.glyphShadow, playIconStyle]}>
                  <PlayPauseGlyph shape={playShape} size={fullscreen ? 44 : 36} />
                </Animated.View>
              )}
            </PressableScale>
            <SkipButton dir={1} size={skipSize} glyph={fullscreen ? 34 : 28} total={forwardTotal} turn={forwardTurn} pop={forwardPop} onPress={skip} />
          </Animated.View>
        )}

        {/* Bottom: times, seek bar (lifted off the edge), quick options */}
        {p.failed ? null : (
          <Animated.View
            style={[styles.bottom, { paddingHorizontal: sideGap, paddingBottom: bottomGap }, bottomStyle]}
            pointerEvents="box-none"
            onLayout={(e) => (bottomZone.value = e.nativeEvent.layout.y)}
          >
            <View style={styles.timeRow} pointerEvents="box-none">
              <TimeLabel time={p.time} duration={p.duration} shown={shown} />
              <View style={{ flex: 1 }} />
              {p.hasNext && !fullscreen ? (
                <PressableScale onPress={p.onNext} style={styles.iconBtnSmall} hitSlop={6} accessibilityLabel="Next episode">
                  <Icon name="skip" size={19} color="#fff" />
                </PressableScale>
              ) : null}
              <PressableScale onPress={p.onToggleFullscreen} style={styles.iconBtnSmall} hitSlop={8} accessibilityLabel={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                <Icon name={fullscreen ? 'exitFullscreen' : 'fullscreen'} size={20} color="#fff" />
              </PressableScale>
            </View>
            <SeekBar time={p.time} duration={p.duration} buffered={p.buffered} onSeek={p.onSeek} onKeepAlive={p.onKeepAlive} />
            {/* Always built, and folded away outside fullscreen: building it during a turn is
                why it used to appear so late. */}
            <View
              style={[styles.chipRow, !fullscreen && styles.chipRowFolded]}
              pointerEvents={fullscreen ? 'box-none' : 'none'}
              importantForAccessibility={fullscreen ? 'auto' : 'no-hide-descendants'}
              onLayout={(e) => setNarrowRow(e.nativeEvent.layout.width < 600)}
            >
                {p.chips.map((c) => (
                  <PressableScale
                    key={c.key}
                    onPress={() => openMenu(c.key)}
                    onLayout={(e) => (chipX.current[c.key] = e.nativeEvent.layout.x)}
                    style={[styles.chip, c.key === 'audio' && styles.chipFlexible, menuKey === c.key && styles.chipOn]}
                    scaleTo={0.95}
                    accessibilityLabel={c.label}
                  >
                    {c.badge ? <QualityBadge name={c.badge} /> : <Icon name={c.icon} size={17} color={PLAYER_COLOURS[c.key] ?? '#fff'} />}
                    <Text style={styles.chipText} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </PressableScale>
                ))}
                <EnhanceChip on={p.enhanced} onPress={p.onToggleEnhance} />
                <View style={{ flex: 1 }} />
                {p.hasNext ? (
                  <PressableScale onPress={p.onNext} style={[styles.chip, styles.nextChip]} scaleTo={0.95} accessibilityLabel="Next episode">
                    {narrowRow ? null : <Text style={[styles.chipText, { color: '#000' }]}>Next episode</Text>}
                    <Icon name="skip" size={15} color="#000" />
                  </PressableScale>
                ) : null}
            </View>
          </Animated.View>
        )}
      </Animated.View>

      <PlayerMiniMenu
        section={menu}
        accent={PLAYER_COLOURS[menuChip?.key ?? ''] ?? '#fff'}
        head={menuChip?.badge ? <QualityBadge name={menuChip.badge} /> : menuChip ? <Icon name={menuChip.icon} size={17} color={PLAYER_COLOURS[menuChip.key] ?? '#fff'} /> : null}
        x={menuX.current} bottom={bottomGap + 38} onClose={closeMenu} />
    </View>
  );
});

// View Enhancement. A band of full colour runs through the button for 1.5 s as it turns on,
// then stays lit; off, only its coloured edge remains. All on the UI thread.
// The whole spectrum repeats once per button width, so it's all visible at any moment.
const SPECTRUM = ['#FF2D55', '#FF9500', '#FFD60A', '#30D158', '#0A84FF', '#BF5AF2'] as const;
const RGB = [...SPECTRUM, ...SPECTRUM, ...SPECTRUM, ...SPECTRUM, SPECTRUM[0]] as const;
const ENHANCE_ANIMATION_MS = 1500;

function EnhanceChip({ on, onPress }: { on: boolean; onPress: () => void }) {
  const [w, setW] = useState(0);
  const sweep = useSharedValue(on ? 1 : 0);
  const lit = useSharedValue(on ? 1 : 0);
  const pulse = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (on) {
      sweep.value = 0;
      sweep.value = withTiming(1, { duration: ENHANCE_ANIMATION_MS, easing: Easing.inOut(Easing.cubic) });
      lit.value = withTiming(1, { duration: ENHANCE_ANIMATION_MS, easing: Easing.inOut(Easing.quad) });
      pulse.value = withSequence(withTiming(1.08, { duration: 300, easing: Easing.out(Easing.quad) }), withDelay(ENHANCE_ANIMATION_MS - 600, withSpring(1, { damping: 12, stiffness: 180 })));
    } else {
      lit.value = withTiming(0, { duration: 220 });
      pulse.value = withSequence(withTiming(0.95, { duration: 90 }), withSpring(1, { damping: 14, stiffness: 240 }));
    }
  }, [on, sweep, lit, pulse]);

  const bandStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -w * 3 * (1 - sweep.value) }] }), [w]);
  const coverStyle = useAnimatedStyle(() => ({ opacity: interpolate(lit.value, [0, 1], [0.94, 0.12]) }));
  const chipStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${sweep.value * 360}deg` }] }));

  return (
    <Animated.View style={chipStyle}>
      <PressableScale
        onPress={onPress}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        style={styles.enhanceChip}
        scaleTo={0.95}
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        accessibilityLabel="View enhancement"
      >
        {w > 0 ? (
          <Animated.View style={[styles.enhanceBand, { width: w * 4 }, bandStyle]} pointerEvents="none">
            <LinearGradient colors={RGB} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        ) : null}
        <Animated.View style={[styles.enhanceCover, coverStyle]} pointerEvents="none" />
        <Animated.View style={iconStyle}>
          <Svg width={15} height={15} viewBox="0 0 24 24" fill="#fff">
            <Path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" />
            <Path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
          </Svg>
        </Animated.View>
        <Text style={styles.enhanceText} numberOfLines={1}>
          Enhance
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

// Auto next: its icon and a small switch, on or off at a glance.
function AutoNextSwitch({ on, onPress }: { on: boolean; onPress: () => void }) {
  const lit = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    lit.value = withTiming(on ? 1 : 0, { duration: 180, easing: Easing.out(Easing.cubic) });
  }, [on, lit]);
  const trackStyle = useAnimatedStyle(() => ({ opacity: interpolate(lit.value, [0, 1], [0.3, 1]) }));
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lit.value * 12 }] }));
  return (
    <PressableScale
      onPress={onPress}
      haptic
      style={styles.autoSwitch}
      hitSlop={6}
      scaleTo={0.94}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel="Auto next episode"
    >
      <Icon name="autoLine" size={19} color={on ? PLAYER_COLOURS.autoNext : 'rgba(255,255,255,0.6)'} />
      <View style={styles.miniSwitch}>
        <Animated.View style={[styles.miniTrack, trackStyle]} />
        <Animated.View style={[styles.miniKnob, knobStyle]} />
      </View>
    </PressableScale>
  );
}

// The size while pinching, to the percent. It says so when it reaches the size that fills the screen.
function ZoomBadge({ zoom, opacity, from }: { zoom: SharedValue<number>; opacity: SharedValue<number>; from: SharedValue<PinchFrom> }) {
  const [pct, setPct] = useState(100);
  const [fills, setFills] = useState(false);
  useAnimatedReaction(
    () => (opacity.value > 0 ? Math.round(zoom.value * 100) : -1),
    (now, before) => {
      if (now < 0 || now === before) return;
      runOnJS(setPct)(now);
      runOnJS(setFills)(from.value.fill > 0 && Math.abs(now - from.value.fill * 100) < 1);
    }
  );
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" style={[styles.zoomBadge, style]}>
      <Text style={styles.zoomText}>{pct}%</Text>
      {fills ? <Text style={styles.zoomHint}>Fills screen</Text> : null}
    </Animated.View>
  );
}

// The fit button: a drawing of the screen and the picture on it. The picture changes shape with
// the mode and grows live under the fingers, and the size shows beside it until it's reset.
const ARect = Animated.createAnimatedComponent(Rect);
const APath = Animated.createAnimatedComponent(Path);
const FIT_COLOUR = '#2DD4BF';

function FitButton({ mode, zoom, onPress }: { mode: SharedValue<FitMode>; zoom: SharedValue<number>; onPress: () => void }) {
  const [pct, setPct] = useState(100);
  useAnimatedReaction(
    () => Math.round(zoom.value * 100),
    (now, before) => {
      if (now !== before) runOnJS(setPct)(now);
    }
  );
  // 0 fit, 1 zoom, 2 stretch, moving smoothly between them.
  const shape = useSharedValue(mode.value === 'contain' ? 0 : mode.value === 'cover' ? 1 : 2);
  useAnimatedReaction(
    () => mode.value,
    (now) => {
      shape.value = withSpring(now === 'contain' ? 0 : now === 'cover' ? 1 : 2, { damping: 16, stiffness: 180 });
    }
  );
  const pictureProps = useAnimatedProps(() => {
    const baseW = interpolate(shape.value, [0, 1, 2], [11, 19, 19]);
    const baseH = interpolate(shape.value, [0, 1, 2], [8, 14, 14]);
    const w = Math.min(19, Math.max(4, baseW * zoom.value));
    const h = Math.min(14, Math.max(3, baseH * zoom.value));
    return { x: 12 - w / 2, y: 12 - h / 2, width: w, height: h };
  });
  const coverProps = useAnimatedProps(() => ({ opacity: Math.max(0, 1 - Math.abs(shape.value - 1) * 2) }));
  const stretchProps = useAnimatedProps(() => ({ opacity: Math.max(0, Math.min(1, (shape.value - 1.5) * 2)) }));
  return (
    <PressableScale onPress={onPress} style={styles.fitBtn} hitSlop={6} scaleTo={0.9} accessibilityLabel={pct === 100 ? 'Screen fit' : `Reset size, now ${pct} percent`}>
      {pct === 100 ? null : <Text style={styles.fitPct}>{pct}%</Text>}
      <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
        <ARect animatedProps={pictureProps} rx={1.5} fill={FIT_COLOUR} fillOpacity={0.28} />
        <Rect x={2.5} y={5} width={19} height={14} rx={2.5} stroke={FIT_COLOUR} strokeWidth={1.6} />
        <APath animatedProps={coverProps} d="M14 8.5h3v3M10 15.5H7v-3" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        <APath animatedProps={stretchProps} d="M6.5 12h11M9 9.5L6.5 12L9 14.5M15 9.5L17.5 12L15 14.5" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </PressableScale>
  );
}

// Play and pause are one drawing: two four-cornered shapes that are bars when playing, and the
// two halves of a triangle when paused. The triangle sits so its weight is on the centre, which
// is what makes it look centred.
const PLAY = [[7.5, 3.5, 14.25, 7.75, 14.25, 16.25, 7.5, 20.5], [14.25, 7.75, 21, 12, 21, 12, 14.25, 16.25]];
const PAUSE = [[6.5, 4.5, 10, 4.5, 10, 19.5, 6.5, 19.5], [14, 4.5, 17.5, 4.5, 17.5, 19.5, 14, 19.5]];

function PlayPauseGlyph({ shape, size }: { shape: SharedValue<number>; size: number }) {
  const props = useAnimatedProps(() => {
    const t = shape.value;
    let d = '';
    for (let part = 0; part < 2; part += 1) {
      for (let i = 0; i < 8; i += 2) {
        const x = PLAY[part][i] + (PAUSE[part][i] - PLAY[part][i]) * t;
        const y = PLAY[part][i + 1] + (PAUSE[part][i + 1] - PLAY[part][i + 1]) * t;
        d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      }
      d += 'Z';
    }
    return { d };
  });
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <APath animatedProps={props} fill="#fff" stroke="#fff" strokeWidth={1} strokeLinejoin="round" />
    </Svg>
  );
}

// The time, redrawn once a second and only while the controls can be seen.
function TimeLabel({ time, duration, shown }: { time: SharedValue<number>; duration: number; shown: SharedValue<number> }) {
  const [sec, setSec] = useState(0);
  useAnimatedReaction(
    () => (shown.value > 0 ? Math.floor(time.value) : -1),
    (now, before) => {
      if (now >= 0 && now !== before) runOnJS(setSec)(now);
    }
  );
  return (
    <Text style={styles.time}>
      {fmt(sec)}
      <Text style={styles.timeDim}>{`  /  ${duration > 0 ? fmt(duration) : '--:--'}`}</Text>
    </Text>
  );
}

function HudReadout({ kind, level, fill }: { kind: 1 | 2; level: SharedValue<number>; fill: object }) {
  const [pct, setPct] = useState(0);
  useAnimatedReaction(
    () => Math.round(level.value * 100),
    (now, before) => {
      if (now !== before) runOnJS(setPct)(now);
    }
  );
  return (
    <>
      {kind === 1 ? <SunIcon /> : <SpeakerIcon muted={pct === 0} />}
      <View style={styles.hudTrack}>
        <Animated.View style={[styles.hudFill, fill]} />
      </View>
      <Text style={styles.hudText}>{pct}%</Text>
    </>
  );
}

// ---- Seek bar ----
// Drag or tap anywhere on it. The thumb follows the finger on the UI thread; the
// video seeks once, when the finger lifts. It only reacts to a real tap or a
// sideways drag, so a finger resting on it or moving up past it never seeks.
function SeekBar({
  time,
  buffered,
  duration,
  onSeek,
  onKeepAlive,
}: {
  time: SharedValue<number>;
  buffered: SharedValue<number>;
  duration: number;
  onSeek: (s: number) => void;
  onKeepAlive: () => void;
}) {
  const width = useSharedValue(1);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(0);
  const lastSec = useSharedValue(-1);
  const [preview, setPreview] = useState(0);

  // Glides between the player's time updates. A jump (resuming, a skip) goes straight
  // there: sliding looked as if something were dragging the bar.
  useAnimatedReaction(
    () => (duration > 0 ? clamp01(time.value / duration) : 0),
    (r) => {
      if (dragging.value) return;
      const far = Math.abs(r - progress.value) * duration > 2;
      progress.value = far ? r : withTiming(r, { duration: 420, easing: Easing.linear });
    },
    [duration]
  );

  const commit = useCallback(
    (r: number) => {
      if (duration > 0) onSeek(r * duration);
    },
    [onSeek, duration]
  );
  const show = useCallback(
    (r: number) => {
      setPreview(r * duration);
      onKeepAlive();
    },
    [duration, onKeepAlive]
  );

  // The bar's real width now: right after a turn, the layout event hasn't reached here yet.
  const barRef = useAnimatedRef<Animated.View>();
  const measureBar = () => {
    'worklet';
    const bar = measure(barRef);
    if (bar && bar.width > 0) width.value = bar.width;
  };

  const drag = usePanGesture({
    activeOffsetX: [-5, 5],
    failOffsetY: [-20, 20],
    onActivate: (e) => {
      'worklet';
      measureBar();
      dragging.value = 1;
      progress.value = clamp01(e.x / width.value);
      lastSec.value = -1;
      runOnJS(show)(progress.value);
    },
    onUpdate: (e) => {
      'worklet';
      progress.value = clamp01(e.x / width.value);
      const sec = Math.floor(progress.value * duration);
      if (sec !== lastSec.value) {
        lastSec.value = sec;
        runOnJS(show)(progress.value);
      }
    },
    onDeactivate: () => {
      'worklet';
      dragging.value = 0;
      runOnJS(commit)(progress.value);
    },
  });
  const tap = useTapGesture({
    maxDistance: 8,
    onActivate: (e) => {
      'worklet';
      measureBar();
      progress.value = clamp01(e.x / width.value);
      runOnJS(commit)(progress.value);
    },
  });
  const gesture = useCompetingGestures(drag, tap);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.001, progress.value) }] }));
  const bufferStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: duration > 0 ? Math.max(0.001, clamp01(buffered.value / duration)) : 0.001 }] }), [duration]);
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: withTiming(dragging.value ? 1.6 : 1, { duration: 120 }) }] }));
  // A percentage of the bar's own width, so the dot stays on the fill through a turn, with
  // nothing to wait for.
  const railStyle = useAnimatedStyle(() => ({ transform: [{ translateX: `${progress.value * 100}%` }] }));
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ scale: withTiming(dragging.value ? 1.35 : 1, { duration: 120 }) }] }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: withTiming(dragging.value ? 1 : 0, { duration: 120 }),
    transform: [{ translateX: Math.min(Math.max(progress.value * width.value - 34, 0), width.value - 68) }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View ref={barRef} style={styles.seek} onLayout={(e) => (width.value = Math.max(1, e.nativeEvent.layout.width))}>
        <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
          <Text style={styles.bubbleText}>{fmt(preview)}</Text>
        </Animated.View>
        <Animated.View style={[styles.track, trackStyle]}>
          <Animated.View style={[styles.trackFill, styles.buffered, bufferStyle]} />
          <Animated.View style={[styles.trackFill, styles.played, fillStyle]} />
        </Animated.View>
        <Animated.View style={[styles.thumbRail, railStyle]} pointerEvents="none">
          <Animated.View style={[styles.thumb, thumbStyle]} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

// A turning arrow around "10", with nothing drawn behind it, plus the small "+10" beside it.
function SkipButton({
  dir,
  size,
  glyph,
  total,
  turn,
  pop,
  onPress,
}: {
  dir: -1 | 1;
  size: number;
  glyph: number;
  total: number;
  turn: SharedValue<number>;
  pop: SharedValue<number>;
  onPress: (side: -1 | 1) => void;
}) {
  const turnStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const popStyle = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ translateX: dir * 8 * pop.value }] }));
  return (
    <View style={{ width: size, height: size }}>
      <PressableScale
        onPress={() => onPress(dir)}
        style={[styles.centerBtn, { width: size, height: size }]}
        scaleTo={0.86}
        hitSlop={8}
        accessibilityLabel={dir < 0 ? 'Back 10 seconds' : 'Forward 10 seconds'}
      >
        <Animated.View style={[styles.glyphShadow, turnStyle]}>
          <Svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none" style={dir < 0 ? { transform: [{ scaleX: -1 }] } : undefined}>
            <Path d="M19.36 8.25A8.5 8.5 0 1 1 12 4" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
            <Path d="M10 1.4L12.6 4L10 6.6" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
        <Text style={[styles.skipNum, { fontSize: Math.round(glyph * 0.3), marginTop: 2 }]}>10</Text>
      </PressableScale>
      <Animated.Text
        pointerEvents="none"
        numberOfLines={1}
        style={[styles.skipPop, { top: size / 2 - 9 }, dir < 0 ? { right: size - 2 } : { left: size - 2 }, popStyle]}
      >
        {`${dir < 0 ? '−' : '+'}${total}`}
      </Animated.Text>
    </View>
  );
}

function SunIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
      <Path d="M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z" fill="#fff" />
      <Path d="M12 1.5v2M12 20.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
    </Svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 9h3l5-4v14l-5-4H4z" fill="#fff" />
      {muted ? <Path d="M16 9l5 6M21 9l-5 6" /> : <Path d="M16 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12" />}
    </Svg>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.22)' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 110 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 150 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  titleWrap: { flex: 1, paddingHorizontal: 6 },
  title: { color: colors.accent, fontFamily: fonts.bold, fontSize: 12.5 },
  subtitle: { color: '#fff', fontFamily: fonts.black, fontSize: 15, marginTop: 1 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconBtnSmall: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  center: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  behindMenu: { filter: [{ blur: 5 }] },
  centerBtn: { alignItems: 'center', justifyContent: 'center' },
  // Keeps white icons readable on a bright picture, with nothing drawn around them.
  glyphShadow: { filter: [{ dropShadow: { offsetX: 0, offsetY: 1, standardDeviation: '3px', color: 'rgba(0,0,0,0.55)' } }] },
  skipNum: { position: 'absolute', color: '#fff', fontFamily: fonts.bold, letterSpacing: -0.2, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  skipPop: { position: 'absolute', color: '#fff', fontFamily: fonts.black, fontSize: 13, lineHeight: 18, textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: 4 },
  spinnerWrap: { alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  time: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  timeDim: { color: 'rgba(255,255,255,0.65)', fontFamily: fonts.medium },
  seek: { height: 28, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  trackFill: { ...StyleSheet.absoluteFill, transformOrigin: 'left' },
  buffered: { backgroundColor: 'rgba(255,255,255,0.4)' },
  played: { backgroundColor: colors.accent },
  thumbRail: { ...StyleSheet.absoluteFill, justifyContent: 'center' },
  thumb: { position: 'absolute', left: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, borderWidth: 2, borderColor: '#fff' },
  bubble: { position: 'absolute', left: 0, bottom: 28, width: 68, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(20,21,25,0.92)', alignItems: 'center' },
  bubbleText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  chipRowFolded: { height: 0, marginTop: 0, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  // Only a language name can be long: on a small phone it gives way, and nothing else is cut.
  chipFlexible: { flexShrink: 1, minWidth: 64 },
  autoSwitch: { height: 40, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniSwitch: { width: 26, height: 14, justifyContent: 'center' },
  miniTrack: { ...StyleSheet.absoluteFill, borderRadius: 7, backgroundColor: '#A78BFA' },
  miniKnob: { width: 12, height: 12, marginLeft: 1, borderRadius: 6, backgroundColor: '#fff' },
  fitBtn: { minWidth: 40, height: 40, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  fitPct: { color: FIT_COLOUR, fontFamily: fonts.bold, fontSize: 12.5 },
  zoomBadge: { position: 'absolute', top: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: 'rgba(14,14,18,0.78)' },
  zoomText: { color: '#fff', fontFamily: fonts.black, fontSize: 15 },
  zoomHint: { color: FIT_COLOUR, fontFamily: fonts.bold, fontSize: 12.5 },
  chipOn: { backgroundColor: 'rgba(255,255,255,0.26)' },
  chipText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5, maxWidth: 140 },
  nextChip: { backgroundColor: '#fff' },
  enhanceChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, overflow: 'hidden' },
  enhanceBand: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  // Inset by the edge's width, so the colour shows as a ring when off.
  enhanceCover: { position: 'absolute', top: 1.5, bottom: 1.5, left: 1.5, right: 1.5, borderRadius: 14.5, backgroundColor: '#15151b' },
  enhanceText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3 },
  hud: {
    position: 'absolute',
    alignSelf: 'center',
    top: '22%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(20,21,25,0.85)',
  },
  hudTrack: { width: 110, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  hudFill: { ...StyleSheet.absoluteFill, backgroundColor: colors.accent, transformOrigin: 'left' },
  hudText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5, minWidth: 36, textAlign: 'right' },
});
