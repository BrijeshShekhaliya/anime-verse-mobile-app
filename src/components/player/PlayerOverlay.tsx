import * as Brightness from 'expo-brightness';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, useCompetingGestures, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
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

export type QuickChip = { key: string; icon: IconName; label: string };

type Insets = { top: number; bottom: number; left: number; right: number };

type Props = {
  visible: boolean;
  fullscreen: boolean;
  title: string;
  subtitle: string;
  isPlaying: boolean;
  isBuffering: boolean;
  time: number;
  duration: number;
  buffered: number;
  volume: number;
  insets: Insets;
  chips: QuickChip[];
  hasNext: boolean;
  onToggleControls: () => void;
  onKeepAlive: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onSeekBy: (delta: number) => void;
  onVolume: (volume: number) => void;
  onBack: () => void;
  onToggleFullscreen: () => void;
  onCycleFit: () => void;
  onOpenSettings: (section?: string) => void;
  onNext: () => void;
};

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
// Gestures and their feedback (brightness / volume levels, ripples, the seek
// thumb) run on the UI thread, so they stay smooth even when the screen is busy.
export const PlayerOverlay = memo(function PlayerOverlay(p: Props) {
  // ---- Controls fade ----
  const shown = useSharedValue(p.visible ? 1 : 0);
  useEffect(() => {
    shown.value = withTiming(p.visible ? 1 : 0, { duration: p.visible ? 180 : 220, easing: Easing.out(Easing.quad) });
  }, [p.visible, shown]);
  const controlsStyle = useAnimatedStyle(() => ({ opacity: shown.value }));
  const topStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(shown.value, [0, 1], [-10, 0]) }] }));
  const bottomStyle = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(shown.value, [0, 1], [12, 0]) }] }));
  const centerStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(shown.value, [0, 1], [0.9, 1]) }] }));

  // ---- Surface size (for left / right halves) ----
  const surfaceW = useSharedValue(1);
  const surfaceH = useSharedValue(1);

  // ---- Brightness / volume drag ----
  const bright = useSharedValue(0.5);
  const vol = useSharedValue(p.volume);
  const hudLevel = useSharedValue(0);
  const hudOpacity = useSharedValue(0);
  const dragKind = useSharedValue(0); // 1 brightness, 2 volume
  const dragStart = useSharedValue(0);
  const lastSent = useSharedValue(0);
  const [hudKind, setHudKind] = useState<1 | 2>(1);
  const [hudPct, setHudPct] = useState(0);

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
      setHudPct(Math.round(level * 100));
      if (kind === 1) {
        if (Platform.OS !== 'web') Brightness.setBrightnessAsync(level).catch(() => {});
      } else p.onVolume(level);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onVolume]
  );

  const pan = usePanGesture({
    activeOffsetY: [-14, 14],
    failOffsetX: [-28, 28],
    maxPointers: 1,
    onActivate: (e) => {
      'worklet';
      const kind = e.x < surfaceW.value / 2 ? 1 : 2;
      dragKind.value = kind;
      dragStart.value = kind === 1 ? bright.value : vol.value;
      hudLevel.value = dragStart.value;
      hudOpacity.value = withTiming(1, { duration: 120 });
      runOnJS(setHudKind)(kind as 1 | 2);
      runOnJS(setHudPct)(Math.round(dragStart.value * 100));
    },
    onUpdate: (e) => {
      'worklet';
      if (!dragKind.value) return;
      const level = clamp01(dragStart.value - e.translationY / (surfaceH.value * 0.8));
      hudLevel.value = level;
      if (dragKind.value === 1) bright.value = level;
      else vol.value = level;
      const now = Date.now();
      if (now - lastSent.value > 45) {
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

  // ---- Taps ----
  const [ripple, setRipple] = useState<{ side: -1 | 0 | 1; total: number; key: number }>({ side: 0, total: 0, key: 0 });
  const rippleOpacity = useSharedValue(0);
  const rippleScale = useSharedValue(0.6);
  const lastDouble = useRef({ side: 0, at: 0, total: 0 });

  // The video's tap gestures also see taps that land on the buttons drawn over
  // it. Any touch on a control is noted here, and the video ignores taps that
  // come with one (so pressing +10 never hides the controls or skips twice).
  const controlTouchAt = useRef(0);
  const markControl = useCallback(() => {
    controlTouchAt.current = Date.now();
  }, []);
  const fromControl = () => Date.now() - controlTouchAt.current < 700;

  // Skip 10 s back / forward. Quick repeats add up ("30 seconds") and show on
  // the side they go to, whether from double-taps or the buttons.
  const skip = useCallback(
    (side: -1 | 1) => {
      const now = Date.now();
      const l = lastDouble.current;
      const total = l.side === side && now - l.at < 900 ? l.total + 10 : 10;
      lastDouble.current = { side, at: now, total };
      p.onSeekBy(side * 10);
      setRipple((r) => ({ side, total, key: r.key + 1 }));
      rippleScale.value = 0.6;
      rippleScale.value = withSpring(1, { damping: 14, stiffness: 160 });
      rippleOpacity.value = withSequence(withTiming(1, { duration: 90 }), withDelay(450, withTiming(0, { duration: 260 })));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onSeekBy]
  );
  const skipButton = useCallback(
    (side: -1 | 1) => {
      skip(side);
      p.onKeepAlive(); // the controls stay up while skipping
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skip, p.onKeepAlive]
  );

  const onDoubleTap = useCallback(
    (x: number) => {
      if (fromControl()) return;
      const w = surfaceW.value;
      const side: -1 | 0 | 1 = x < w * 0.36 ? -1 : x > w * 0.64 ? 1 : 0;
      if (side === 0) p.onTogglePlay();
      else skip(side);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onTogglePlay, skip]
  );

  const singleTap = useTapGesture({
    runOnJS: true,
    maxDuration: 260,
    onActivate: () => {
      if (!fromControl()) p.onToggleControls();
    },
  });
  const doubleTap = useTapGesture({ runOnJS: true, numberOfTaps: 2, maxDelay: 240, onActivate: (e) => onDoubleTap(e.x) });
  const taps = useExclusiveGestures(doubleTap, singleTap);
  const gestures = useCompetingGestures(pan, taps);

  const rippleStyle = useAnimatedStyle(() => ({ opacity: rippleOpacity.value, transform: [{ scale: rippleScale.value }] }));
  const hudStyle = useAnimatedStyle(() => ({ opacity: hudOpacity.value }));
  const hudFill = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.001, hudLevel.value) }] }));

  const side = p.fullscreen ? Math.max(p.insets.left, p.insets.right, 20) : 12;
  const bottomGap = p.fullscreen ? Math.max(p.insets.bottom, 10) + 16 : 10;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Gesture surface (under the controls). */}
      <GestureDetector gesture={gestures}>
        <Animated.View
          style={StyleSheet.absoluteFill}
          onLayout={(e) => {
            surfaceW.value = e.nativeEvent.layout.width;
            surfaceH.value = e.nativeEvent.layout.height;
          }}
        />
      </GestureDetector>

      {/* Double-tap ripple: a soft half-disc on that side with the seconds. */}
      {ripple.side !== 0 ? (
        <Animated.View pointerEvents="none" style={[styles.ripple, ripple.side < 0 ? styles.rippleLeft : styles.rippleRight, rippleStyle]}>
          <View style={styles.rippleContent}>
            <Text style={styles.rippleArrows}>{ripple.side < 0 ? '«' : '»'}</Text>
            <Text style={styles.rippleText}>{ripple.total} seconds</Text>
          </View>
        </Animated.View>
      ) : null}

      {/* Brightness / volume level. */}
      <Animated.View pointerEvents="none" style={[styles.hud, hudStyle]}>
        {hudKind === 1 ? <SunIcon /> : <SpeakerIcon muted={hudPct === 0} />}
        <View style={styles.hudTrack}>
          <Animated.View style={[styles.hudFill, hudFill]} />
        </View>
        <Text style={styles.hudText}>{hudPct}%</Text>
      </Animated.View>

      {/* Controls. */}
      <Animated.View style={[StyleSheet.absoluteFill, controlsStyle]} pointerEvents={p.visible ? 'box-none' : 'none'} onTouchStart={markControl}>
        <View style={styles.dim} pointerEvents="none" />
        <LinearGradient colors={['rgba(0,0,0,0.75)', 'transparent']} style={styles.topScrim} pointerEvents="none" />
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.bottomScrim} pointerEvents="none" />

        {/* Top bar */}
        <Animated.View
          style={[styles.topBar, { paddingTop: p.fullscreen ? Math.max(p.insets.top, 10) + 6 : 8, paddingHorizontal: side }, topStyle]}
          pointerEvents="box-none"
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
          <PressableScale onPress={p.onCycleFit} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Screen fit">
            <Icon name="aspectRatio" size={21} color="#fff" />
          </PressableScale>
          <PressableScale onPress={() => p.onOpenSettings()} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Player settings">
            <Icon name="settings" size={21} color="#fff" />
          </PressableScale>
        </Animated.View>

        {/* Centre */}
        <Animated.View style={[styles.center, { gap: p.fullscreen ? 72 : 44 }, centerStyle]} pointerEvents="box-none">
          <PressableScale onPressIn={markControl} onPress={() => skipButton(-1)} style={[styles.skipBtn, p.fullscreen && styles.skipBtnBig]} scaleTo={0.88} hitSlop={12} accessibilityLabel="Back 10 seconds">
            <SkipIcon dir={-1} size={p.fullscreen ? 34 : 30} />
          </PressableScale>
          <PressableScale onPress={p.onTogglePlay} style={[styles.playBtn, p.fullscreen && styles.playBtnBig]} scaleTo={0.9} accessibilityLabel={p.isPlaying ? 'Pause' : 'Play'}>
            {p.isBuffering && p.isPlaying ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : (
              <Icon name={p.isPlaying ? 'pause' : 'play'} size={p.fullscreen ? 38 : 32} color="#fff" />
            )}
          </PressableScale>
          <PressableScale onPressIn={markControl} onPress={() => skipButton(1)} style={[styles.skipBtn, p.fullscreen && styles.skipBtnBig]} scaleTo={0.88} hitSlop={12} accessibilityLabel="Forward 10 seconds">
            <SkipIcon dir={1} size={p.fullscreen ? 34 : 30} />
          </PressableScale>
        </Animated.View>

        {/* Bottom: times, seek bar (lifted off the edge), quick options */}
        <Animated.View style={[styles.bottom, { paddingHorizontal: side, paddingBottom: bottomGap }, bottomStyle]} pointerEvents="box-none">
          <View style={styles.timeRow} pointerEvents="box-none">
            <Text style={styles.time}>
              {fmt(p.time)}
              <Text style={styles.timeDim}>{`  /  ${fmt(p.duration)}`}</Text>
            </Text>
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
                <PressableScale key={c.key} onPress={() => p.onOpenSettings(c.key)} style={styles.chip} scaleTo={0.95} accessibilityLabel={c.label}>
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
      </Animated.View>
    </View>
  );
});

// ---- Seek bar ----
// Drag or tap anywhere on it. The thumb follows the finger on the UI thread;
// the video seeks once, when the finger lifts.
function SeekBar({ time, duration, buffered, onSeek, onKeepAlive }: { time: number; duration: number; buffered: number; onSeek: (s: number) => void; onKeepAlive: () => void }) {
  const width = useSharedValue(1);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(0);
  const [preview, setPreview] = useState<number | null>(null);
  const ratio = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
  const bufRatio = duration > 0 ? Math.min(1, Math.max(0, buffered / duration)) : 0;

  useEffect(() => {
    if (!dragging.value) progress.value = withTiming(ratio, { duration: 220, easing: Easing.linear });
  }, [ratio, progress, dragging]);

  const startDrag = useCallback(() => onKeepAlive(), [onKeepAlive]);
  const commit = useCallback(
    (r: number) => {
      setPreview(null);
      onSeek(r * duration);
    },
    [onSeek, duration]
  );
  const show = useCallback((r: number) => setPreview(r * duration), [duration]);

  const drag = usePanGesture({
    minDistance: 0,
    onActivate: (e) => {
      'worklet';
      dragging.value = 1;
      progress.value = clamp01(e.x / width.value);
      runOnJS(startDrag)();
      runOnJS(show)(progress.value);
    },
    onUpdate: (e) => {
      'worklet';
      progress.value = clamp01(e.x / width.value);
      runOnJS(show)(progress.value);
    },
    onDeactivate: () => {
      'worklet';
      dragging.value = 0;
      runOnJS(commit)(progress.value);
    },
  });

  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.001, progress.value) }] }));
  const trackStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: withTiming(dragging.value ? 1.6 : 1, { duration: 120 }) }] }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * width.value - 8 }, { scale: withTiming(dragging.value ? 1.35 : 1, { duration: 120 }) }],
  }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: withTiming(dragging.value ? 1 : 0, { duration: 120 }),
    transform: [{ translateX: Math.min(Math.max(progress.value * width.value - 34, 0), width.value - 68) }],
  }));

  return (
    <GestureDetector gesture={drag}>
      <Animated.View style={styles.seek} onLayout={(e) => (width.value = Math.max(1, e.nativeEvent.layout.width))} hitSlop={{ top: 10, bottom: 10 }}>
        <Animated.View style={[styles.bubble, bubbleStyle]} pointerEvents="none">
          <Text style={styles.bubbleText}>{fmt(preview ?? time)}</Text>
        </Animated.View>
        <Animated.View style={[styles.track, trackStyle]}>
          <View style={[styles.trackFill, styles.buffered, { transform: [{ scaleX: Math.max(0.001, bufRatio) }] }]} />
          <Animated.View style={[styles.trackFill, styles.played, fillStyle]} />
        </Animated.View>
        <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
      </Animated.View>
    </GestureDetector>
  );
}

// A round arrow with "10" in the middle; the arrow turns forward or back.
function SkipIcon({ dir, size }: { dir: -1 | 1; size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={dir < 0 ? { transform: [{ scaleX: -1 }] } : undefined}>
        <Path d="M19.36 8.25A8.5 8.5 0 1 1 12 4" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
        <Path d="M10 1.4L12.6 4L10 6.6" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <Text style={[styles.skipNum, { fontSize: Math.round(size * 0.32), marginTop: 2 }]}>10</Text>
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
  skipBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' },
  skipBtnBig: { width: 60, height: 60, borderRadius: 30 },
  skipNum: { position: 'absolute', color: '#fff', fontFamily: fonts.black, letterSpacing: -0.3 },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  playBtnBig: { width: 76, height: 76, borderRadius: 38 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  time: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  timeDim: { color: 'rgba(255,255,255,0.65)', fontFamily: fonts.medium },
  seek: { height: 26, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  trackFill: { ...StyleSheet.absoluteFill, transformOrigin: 'left' },
  buffered: { backgroundColor: 'rgba(255,255,255,0.4)' },
  played: { backgroundColor: colors.accent },
  thumb: { position: 'absolute', left: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, borderWidth: 2, borderColor: '#fff' },
  bubble: { position: 'absolute', left: 0, bottom: 28, width: 68, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(20,21,25,0.92)', alignItems: 'center' },
  bubbleText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  chipText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5, maxWidth: 140 },
  nextChip: { backgroundColor: '#fff' },
  ripple: { position: 'absolute', top: '-25%', bottom: '-25%', width: '42%', backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center' },
  rippleLeft: { left: 0, borderTopRightRadius: 9999, borderBottomRightRadius: 9999, alignItems: 'center' },
  rippleRight: { right: 0, borderTopLeftRadius: 9999, borderBottomLeftRadius: 9999, alignItems: 'center' },
  rippleContent: { alignItems: 'center' },
  rippleArrows: { color: '#fff', fontFamily: fonts.black, fontSize: 26, lineHeight: 28 },
  rippleText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5, marginTop: 2 },
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
