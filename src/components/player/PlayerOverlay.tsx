import * as Brightness from 'expo-brightness';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  type SharedValue,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { colors, fonts } from '@/lib/theme';
import { MINI_MENU_WIDTH, PlayerMiniMenu } from './PlayerMiniMenu';
import type { SheetSection } from './PlayerSettingsSheet';

export type QuickChip = { key: string; icon: IconName; label: string };

type Insets = { top: number; bottom: number; left: number; right: number };

type Props = {
  visible: boolean;
  locked: boolean; // a panel is open over the player: taps on the video do nothing
  failed: boolean; // nothing to play: only the top bar, and touches pass to what's underneath
  fullscreen: boolean;
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
  // ---- Controls fade ----
  const shown = useSharedValue(p.visible ? 1 : 0);
  const wanted = useSharedValue(p.visible);
  useEffect(() => {
    const next = p.visible;
    runOnUI(() => {
      'worklet';
      if (wanted.value === next) return;
      wanted.value = next;
      shown.value = withTiming(next ? 1 : 0, { duration: next ? 140 : 200, easing: Easing.out(Easing.quad) });
    })();
  }, [p.visible, shown, wanted]);
  const controlsStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const topStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(shown.value, [0, 1], [-8, 0]) }] }));
  const bottomStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(shown.value, [0, 1], [8, 0]) }] }));
  const centerStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(shown.value, [0, 1], [0.94, 1]) }] }));

  // ---- Where things are (for telling a tap on the video from a tap on a button) ----
  const surfaceW = useSharedValue(1);
  const surfaceH = useSharedValue(1);
  const topZone = useSharedValue(0);
  const bottomZone = useSharedValue(1e7);
  const skipSize = p.fullscreen ? 58 : 48;
  const playSize = p.fullscreen ? 74 : 62;
  const centerGap = p.fullscreen ? 64 : 36;
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
  const sideGap = p.fullscreen ? Math.max(p.insets.left, p.insets.right, 20) : 12;
  const bottomGap = p.fullscreen ? Math.max(p.insets.bottom, 10) + 16 : 10;
  const { onHoldControls, onKeepAlive, onControlsShown, onControlsHidden, onSeekBy, onTogglePlay, onVolume } = p;

  const openMenu = useCallback(
    (key: string) => {
      const left = sideGap + (chipX.current[key] ?? 0);
      menuX.current = Math.max(sideGap, Math.min(left, surfaceSize.current.w - MINI_MENU_WIDTH - sideGap));
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
    if (!p.fullscreen) setMenuKey(null);
  }, [p.fullscreen]);
  useEffect(() => {
    blocked.value = p.locked || !!menuKey;
  }, [p.locked, menuKey, blocked]);

  // ---- Brightness / volume drag ----
  const bright = useSharedValue(0.5);
  const vol = useSharedValue(p.volume);
  const hudLevel = useSharedValue(0);
  const hudOpacity = useSharedValue(0);
  const dragKind = useSharedValue(0); // 1 brightness, 2 volume
  const dragStart = useSharedValue(0);
  const lastSent = useSharedValue(0);
  const [hudKind, setHudKind] = useState<1 | 2>(1);

  useEffect(() => {
    vol.value = p.volume;
  }, [p.volume, vol]);
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
      } else onVolume(level);
    },
    [onVolume]
  );

  const pan = usePanGesture({
    activeOffsetY: [-22, 22],
    failOffsetX: [-24, 24],
    maxPointers: 1,
    onActivate: (e) => {
      'worklet';
      const startY = e.y - e.translationY;
      // Not from a screen edge (that's the phone's own gesture), a button, or under a panel.
      if (blocked.value || startY < 30 || startY > surfaceH.value - 30 || (wanted.value && onControl(e.x, startY))) return;
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
  const tellShown = useCallback(() => onControlsShown(), [onControlsShown]);
  const tellHidden = useCallback(() => onControlsHidden(), [onControlsHidden]);

  const tap = useTapGesture({
    maxDuration: 400,
    maxDistance: 16,
    onActivate: (e) => {
      'worklet';
      if (blocked.value || (wanted.value && onControl(e.x, e.y))) return;
      const now = Date.now();
      const w = surfaceW.value;
      const zone = e.x < w * 0.36 ? -1 : e.x > w * 0.64 ? 1 : 0;
      const isRepeat = zone !== 0 && zone === repeatSide.value && now < repeatUntil.value;
      const isSecond = now - lastTapAt.value < DOUBLE_TAP_MS && Math.abs(e.x - lastTapX.value) < 70;
      if (isRepeat || isSecond) {
        // A double-tap: the controls stay up (this also calls off a hide just begun).
        lastTapAt.value = 0;
        wanted.value = true;
        shown.value = withTiming(1, { duration: 120 });
        repeatSide.value = zone;
        repeatUntil.value = now + REPEAT_MS;
        runOnJS(onDoubleTap)(zone);
        return;
      }
      lastTapAt.value = now;
      lastTapX.value = e.x;
      if (wanted.value) {
        wanted.value = false;
        shown.value = withDelay(
          DOUBLE_TAP_MS,
          withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) }, (done) => {
            if (done) runOnJS(tellHidden)();
          })
        );
      } else {
        wanted.value = true;
        shown.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) });
        runOnJS(tellShown)();
      }
    },
  });
  const gestures = useCompetingGestures(pan, tap);

  const hudStyle = useAnimatedStyle(() => ({ opacity: hudOpacity.value }));
  const hudFill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.001, hudLevel.value) }] }));

  // ---- Play button ----
  const playPop = useSharedValue(1);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    playPop.value = withSequence(withTiming(0.8, { duration: 70 }), withSpring(1, { damping: 12, stiffness: 260 }));
  }, [p.isPlaying, playPop]);
  const playIconStyle = useAnimatedStyle(() => ({ transform: [{ scale: playPop.value }] }));

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

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Gesture surface (under the controls). */}
      <GestureDetector gesture={gestures}>
        <Animated.View
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

      {/* Brightness / volume level. */}
      <Animated.View pointerEvents="none" style={[styles.hud, hudStyle]}>
        <HudReadout kind={hudKind} level={hudLevel} fill={hudFill} />
      </Animated.View>

      {/* Controls. */}
      <Animated.View style={[StyleSheet.absoluteFill, controlsStyle]} pointerEvents={p.visible ? 'box-none' : 'none'}>
        {p.failed ? null : <View style={styles.dim} pointerEvents="none" />}
        <LinearGradient colors={['rgba(0,0,0,0.75)', 'transparent']} style={styles.topScrim} pointerEvents="none" />
        {p.failed ? null : <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.bottomScrim} pointerEvents="none" />}

        {/* Top bar */}
        <Animated.View
          style={[styles.topBar, { paddingTop: p.fullscreen ? Math.max(p.insets.top, 10) + 6 : 8, paddingHorizontal: sideGap }, topStyle]}
          pointerEvents="box-none"
          onLayout={(e) => (topZone.value = e.nativeEvent.layout.height)}
        >
          <PressableScale onPress={p.onBack} style={styles.iconBtn} hitSlop={8} accessibilityLabel={p.fullscreen ? 'Exit fullscreen' : 'Back'}>
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
          {p.failed ? null : (
            <PressableScale onPress={p.onCycleFit} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Screen fit">
              <Icon name="aspectRatio" size={21} color="#fff" />
            </PressableScale>
          )}
          {p.failed ? null : (
            <PressableScale onPress={p.onOpenSettings} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Player settings">
              <Icon name="settings" size={21} color="#fff" />
            </PressableScale>
          )}
        </Animated.View>

        {/* Centre */}
        {p.failed ? null : (
          <Animated.View style={[styles.center, { gap: centerGap }, centerStyle]} pointerEvents="box-none">
            <SkipButton dir={-1} size={skipSize} total={backTotal} turn={backTurn} pop={backPop} onPress={skip} />
            <PressableScale
              onPress={p.onTogglePlay}
              style={[styles.round, { width: playSize, height: playSize, borderRadius: playSize / 2 }]}
              scaleTo={0.9}
              accessibilityLabel={p.isPlaying ? 'Pause' : 'Play'}
            >
              {spinner ? (
                <ActivityIndicator size="large" color="#fff" />
              ) : (
                <Animated.View style={[!p.isPlaying && styles.playNudge, playIconStyle]}>
                  <Icon name={p.isPlaying ? 'pause' : 'play'} size={p.fullscreen ? 34 : 28} color="#fff" />
                </Animated.View>
              )}
            </PressableScale>
            <SkipButton dir={1} size={skipSize} total={forwardTotal} turn={forwardTurn} pop={forwardPop} onPress={skip} />
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
              {p.hasNext && !p.fullscreen ? (
                <PressableScale onPress={p.onNext} style={styles.iconBtnSmall} hitSlop={6} accessibilityLabel="Next episode">
                  <Icon name="skip" size={19} color="#fff" />
                </PressableScale>
              ) : null}
              <PressableScale onPress={p.onToggleFullscreen} style={styles.iconBtnSmall} hitSlop={8} accessibilityLabel={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                <Icon name={p.fullscreen ? 'exitFullscreen' : 'fullscreen'} size={20} color="#fff" />
              </PressableScale>
            </View>
            <SeekBar time={p.time} duration={p.duration} buffered={p.buffered} onSeek={p.onSeek} onKeepAlive={p.onKeepAlive} />
            {p.fullscreen ? (
              <View style={styles.chipRow} pointerEvents="box-none">
                {p.chips.map((c) => (
                  <PressableScale
                    key={c.key}
                    onPress={() => openMenu(c.key)}
                    onLayout={(e) => (chipX.current[c.key] = e.nativeEvent.layout.x)}
                    style={[styles.chip, menuKey === c.key && styles.chipOn]}
                    scaleTo={0.95}
                    accessibilityLabel={c.label}
                  >
                    <Icon name={c.icon} size={15} color="#fff" />
                    <Text style={styles.chipText} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </PressableScale>
                ))}
                <View style={{ flex: 1 }} />
                {p.hasNext ? (
                  <PressableScale onPress={p.onNext} style={[styles.chip, styles.nextChip]} scaleTo={0.95} accessibilityLabel="Next episode">
                    <Text style={[styles.chipText, { color: '#000' }]}>Next episode</Text>
                    <Icon name="skip" size={15} color="#000" />
                  </PressableScale>
                ) : null}
              </View>
            ) : null}
          </Animated.View>
        )}
      </Animated.View>

      <PlayerMiniMenu section={menu} x={menuX.current} bottom={bottomGap + 40} maxHeight={Math.max(120, surfaceSize.current.h - bottomGap - 54)} onClose={closeMenu} />
    </View>
  );
});

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
      <Text style={styles.timeDim}>{`  /  ${fmt(duration)}`}</Text>
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

  // Glides between the player's time updates; a jump (a skip) moves quickly.
  useAnimatedReaction(
    () => (duration > 0 ? clamp01(time.value / duration) : 0),
    (r) => {
      if (dragging.value) return;
      const far = Math.abs(r - progress.value) * duration > 2;
      progress.value = withTiming(r, far ? { duration: 140, easing: Easing.out(Easing.quad) } : { duration: 420, easing: Easing.linear });
    },
    [duration]
  );

  const commit = useCallback((r: number) => onSeek(r * duration), [onSeek, duration]);
  const show = useCallback(
    (r: number) => {
      setPreview(r * duration);
      onKeepAlive();
    },
    [duration, onKeepAlive]
  );

  const drag = usePanGesture({
    activeOffsetX: [-5, 5],
    failOffsetY: [-20, 20],
    onActivate: (e) => {
      'worklet';
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
      progress.value = clamp01(e.x / width.value);
      runOnJS(commit)(progress.value);
    },
  });
  const gesture = useCompetingGestures(drag, tap);

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.001, progress.value) }] }));
  const bufferStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: duration > 0 ? Math.max(0.001, clamp01(buffered.value / duration)) : 0.001 }] }), [duration]);
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: withTiming(dragging.value ? 1.6 : 1, { duration: 120 }) }] }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * width.value - 8 }, { scale: withTiming(dragging.value ? 1.35 : 1, { duration: 120 }) }],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: withTiming(dragging.value ? 1 : 0, { duration: 120 }),
    transform: [{ translateX: Math.min(Math.max(progress.value * width.value - 34, 0), width.value - 68) }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.seek} onLayout={(e) => (width.value = Math.max(1, e.nativeEvent.layout.width))}>
        <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
          <Text style={styles.bubbleText}>{fmt(preview)}</Text>
        </Animated.View>
        <Animated.View style={[styles.track, trackStyle]}>
          <Animated.View style={[styles.trackFill, styles.buffered, bufferStyle]} />
          <Animated.View style={[styles.trackFill, styles.played, fillStyle]} />
        </Animated.View>
        <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
      </Animated.View>
    </GestureDetector>
  );
}

// Round button with a turning arrow and "10", plus the small "+10" beside it.
function SkipButton({
  dir,
  size,
  total,
  turn,
  pop,
  onPress,
}: {
  dir: -1 | 1;
  size: number;
  total: number;
  turn: SharedValue<number>;
  pop: SharedValue<number>;
  onPress: (side: -1 | 1) => void;
}) {
  const icon = Math.round(size * 0.58);
  const turnStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const popStyle = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ translateX: dir * 6 * pop.value }] }));
  return (
    <View style={{ width: size, height: size }}>
      <PressableScale
        onPress={() => onPress(dir)}
        style={[styles.round, { width: size, height: size, borderRadius: size / 2 }]}
        scaleTo={0.9}
        hitSlop={12}
        accessibilityLabel={dir < 0 ? 'Back 10 seconds' : 'Forward 10 seconds'}
      >
        <Animated.View style={turnStyle}>
          <Svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" style={dir < 0 ? { transform: [{ scaleX: -1 }] } : undefined}>
            <Path d="M19.36 8.25A8.5 8.5 0 1 1 12 4" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
            <Path d="M10 1.4L12.6 4L10 6.6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </Animated.View>
        <Text style={[styles.skipNum, { fontSize: Math.round(icon * 0.33), marginTop: 2 }]}>10</Text>
      </PressableScale>
      <Animated.Text
        pointerEvents="none"
        numberOfLines={1}
        style={[styles.skipPop, { top: size / 2 - 9 }, dir < 0 ? { right: size + 6 } : { left: size + 6 }, popStyle]}
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
  // The same round glass button for skip and play: a soft dark disc with a thin edge.
  round: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,14,18,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  playNudge: { marginLeft: 3 }, // a triangle looks off-centre until nudged towards its point
  skipNum: { position: 'absolute', color: '#fff', fontFamily: fonts.black, letterSpacing: -0.3 },
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
  thumb: { position: 'absolute', left: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, borderWidth: 2, borderColor: '#fff' },
  bubble: { position: 'absolute', left: 0, bottom: 28, width: 68, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(20,21,25,0.92)', alignItems: 'center' },
  bubbleText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  chipOn: { backgroundColor: 'rgba(255,255,255,0.26)' },
  chipText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5, maxWidth: 140 },
  nextChip: { backgroundColor: '#fff' },
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
