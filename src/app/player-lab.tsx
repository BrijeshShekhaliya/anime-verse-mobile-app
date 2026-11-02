// Player 2.1 — a standalone custom video player (not connected to any of the
// app's streaming sources). It plays openly licensed demo videos.
//
// Fullscreen is real landscape: the phone rotates (button, back button, or
// turning the phone). Kept smooth by: one player element that is never rebuilt;
// the layout follows the real measured screen size the moment it changes (never
// before); a TextureView video surface on Android, which follows size changes;
// and controls that fade in after the rotation instead of jumping around.
import * as Brightness from 'expo-brightness';
import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import * as NavigationBar from 'expo-navigation-bar';
import { router } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Accelerometer } from 'expo-sensors';
import { useVideoPlayer, VideoView, type VideoContentFit } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  PanResponder,
  Platform,
  Pressable,
  StatusBar,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  SlideInRight,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { colors, fonts, radius, springs } from '@/lib/theme';

// Openly licensed demo videos (Blender Foundation open movies, CC BY; Apple's public test stream).
const DEMOS = [
  {
    key: 'bbb',
    title: 'Big Buck Bunny',
    sub: 'Blender Foundation · CC BY 3.0',
    uri: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    thumb: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/500px-Big_buck_bunny_poster_big.jpg',
  },
  {
    key: 'tos',
    title: 'Tears of Steel',
    sub: 'Blender Foundation · CC BY 3.0',
    uri: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    thumb: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Tos-poster.png/500px-Tos-poster.png',
  },
  {
    key: 'bipbop',
    title: 'Apple HLS test stream',
    sub: 'Apple Developer sample · adaptive quality',
    uri: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    thumb: undefined as string | undefined,
  },
];
type Demo = (typeof DEMOS)[number];

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const FITS: { key: VideoContentFit; label: string; hint: string }[] = [
  { key: 'contain', label: 'Fit', hint: 'Whole picture, bars where needed' },
  { key: 'cover', label: 'Fill', hint: 'Fills the screen, edges may crop' },
  { key: 'fill', label: 'Stretch', hint: 'Stretches to the screen' },
];
const HIDE_AFTER = 3000;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export default function PlayerLab() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  // The real drawable area, measured on this screen. (On many Android phones
  // the reported window height leaves out the navigation bar area even though
  // the app draws edge to edge, which left an empty strip in fullscreen.)
  const win = useWindowDimensions();
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const W = area?.w ?? win.width;
  const H = area?.h ?? win.height;
  const inlineH = Math.round((W * 9) / 16);

  // ---------- Player ----------
  const [demo, setDemo] = useState<Demo>(DEMOS[0]);
  const player = useVideoPlayer(demo.uri, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<string>('loading');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [rate, setRate] = useState(1);
  useEffect(() => {
    const subs = [
      player.addListener('playingChange', (e) => setPlaying(e.isPlaying)),
      player.addListener('statusChange', (e) => {
        setStatus(e.status);
        if (e.status === 'readyToPlay') setDuration(player.duration || 0);
      }),
      player.addListener('timeUpdate', (e) => {
        setTime(e.currentTime);
        setBuffered(player.bufferedPosition || 0);
        if (player.duration) setDuration(player.duration);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  const switchTo = (d: Demo) => {
    if (d.key === demo.key) return;
    setDemo(d);
    setTime(0);
    setDuration(0);
    setStatus('loading');
    player.replace(d.uri);
    player.play();
  };

  // ---------- Rotation follows the phone; brightness restored on leaving ----------
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    let original: number | null = null;
    Brightness.getBrightnessAsync()
      .then((b) => {
        original = b;
        brightness.current = b;
      })
      .catch(() => {});
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
      StatusBar.setHidden(false, 'fade');
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('visible').catch(() => {});
        Brightness.restoreSystemBrightnessAsync().catch(() => {});
      } else if (original != null) Brightness.setBrightnessAsync(original).catch(() => {});
    };
  }, []);

  // ---------- Controls: fade in/out, auto-hide while playing ----------
  const [shown, setShown] = useState(true);
  const controls = useSharedValue(1);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showControls = useCallback(
    (autoHide: boolean) => {
      setShown(true);
      controls.value = withTiming(1, { duration: 160 });
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (autoHide)
        hideTimer.current = setTimeout(() => {
          setShown(false);
          controls.value = withTiming(0, { duration: 260 });
        }, HIDE_AFTER);
    },
    [controls]
  );
  const hideControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShown(false);
    controls.value = withTiming(0, { duration: 220 });
  }, [controls]);
  useEffect(() => {
    showControls(playing);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [playing, showControls]);
  const controlsStyle = useAnimatedStyle(() => ({ opacity: controls.value }));

  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const togglePlay = () => {
    pop.value = withSequence(withTiming(0.8, { duration: 90 }), withSpring(1, springs.bouncy));
    if (playing) player.pause();
    else {
      if (duration && time >= duration - 0.5) player.currentTime = 0;
      player.play();
    }
  };
  const seekBy = useCallback(
    (s: number) => {
      player.seekBy(s);
      setTime((t) => Math.max(0, t + s));
    },
    [player]
  );

  // ---------- Fullscreen = real landscape (the layout follows the screen) ----------
  const full = W > H;
  const ov = useSharedValue(1); // controls fade in after each rotation
  const overlayAnim = useAnimatedStyle(() => ({ opacity: ov.value }));

  // Button/back-button rotation locks the screen. Turning the phone afterwards
  // still works: the accelerometer tells us how the phone is really held.
  //  - Entered with the button (locked landscape): holding the phone upright
  //    for a moment exits fullscreen, like YouTube.
  //  - Exited with the button (locked portrait): once the phone is held upright,
  //    rotation is handed back to the phone (so it doesn't snap straight back).
  const lockMode = useRef<'landscape' | 'portrait' | null>(null);
  const setFullscreen = useCallback(
    (on: boolean) => {
      ov.value = 0;
      lockMode.current = on ? 'landscape' : 'portrait';
      ScreenOrientation.lockAsync(on ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    },
    [ov]
  );
  useEffect(() => {
    let uprightSince = 0;
    Accelerometer.setUpdateInterval(250);
    const sub = Accelerometer.addListener(({ x, y }) => {
      const mode = lockMode.current;
      if (!mode) return;
      const ax = Math.abs(x);
      const ay = Math.abs(y);
      const upright = ay > ax + 0.3;
      if (mode === 'portrait' && upright) {
        lockMode.current = null;
        ScreenOrientation.unlockAsync().catch(() => {});
      } else if (mode === 'landscape') {
        if (!upright) uprightSince = 0;
        else if (!uprightSince) uprightSince = Date.now();
        else if (Date.now() - uprightSince > 700) {
          uprightSince = 0;
          setFullscreen(false);
        }
      }
    });
    return () => sub.remove();
  }, [setFullscreen]);

  // Each time the screen turns: hide the system bars in landscape, and fade the
  // controls in on the new layout.
  useEffect(() => {
    StatusBar.setHidden(full, 'fade');
    if (Platform.OS === 'android') NavigationBar.setVisibilityAsync(full ? 'hidden' : 'visible').catch(() => {});
    ov.value = 0;
    ov.value = withTiming(1, { duration: 220 });
    showControls(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!full) return false;
      setFullscreen(false);
      return true;
    });
    return () => sub.remove();
  }, [full, setFullscreen]);

  // The player box: the whole screen in landscape, the inline area in portrait.
  const box = full ? { left: 0, top: 0, width: W, height: H } : { left: 0, top: insets.top, width: W, height: inlineH };
  // Its size, for gestures.
  const size = { w: box.width, h: box.height };

  // ---------- View options ----------
  const [fit, setFit] = useState<VideoContentFit>('contain');
  const [ambient, setAmbient] = useState(true);
  const [viewOpen, setViewOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const chooseRate = (r: number) => {
    player.playbackRate = r;
    setRate(r);
    setSpeedOpen(false);
  };

  // ---------- Gestures: taps, double-tap skip, brightness/volume swipes ----------
  const [hud, setHud] = useState<{ kind: 'bright' | 'volume'; value: number } | null>(null);
  const hudOpacity = useSharedValue(0);
  const hudStyle = useAnimatedStyle(() => ({ opacity: hudOpacity.value, transform: [{ scale: 0.9 + hudOpacity.value * 0.1 }] }));
  const brightness = useRef(0.6);
  const volume = useRef(1);
  const [ripple, setRipple] = useState<{ side: 'left' | 'right'; n: number } | null>(null);
  useEffect(() => {
    if (!ripple) return;
    const t = setTimeout(() => setRipple(null), 650);
    return () => clearTimeout(t);
  }, [ripple]);

  // Latest values for the responder (it's created once).
  const live = useRef({ full, shown, playing, size, seekBy, showControls, hideControls });
  live.current = { full, shown, playing, size, seekBy, showControls, hideControls };
  const swipe = useRef({ active: false, kind: 'bright' as 'bright' | 'volume', base: 0, x: 0, lastSet: 0 });
  const tap = useRef<{ t: number; side: 'left' | 'right'; timer: ReturnType<typeof setTimeout> | null }>({ t: 0, side: 'left', timer: null });

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        swipe.current.active = false;
        swipe.current.x = e.nativeEvent.locationX; // in the player's own frame
      },
      onPanResponderMove: (_, g) => {
        const L = live.current;
        if (!L.full) return;
        const along = g.dy; // up/down movement (negative = up)
        const across = g.dx;
        if (!swipe.current.active) {
          if (Math.abs(along) < 10 || Math.abs(along) < Math.abs(across)) return;
          swipe.current.active = true;
          swipe.current.kind = swipe.current.x < L.size.w / 2 ? 'bright' : 'volume';
          swipe.current.base = swipe.current.kind === 'bright' ? brightness.current : volume.current;
        }
        const v = clamp(swipe.current.base - along / (L.size.h * 0.75));
        if (swipe.current.kind === 'bright') {
          brightness.current = v;
          const now = Date.now();
          if (now - swipe.current.lastSet > 40) {
            swipe.current.lastSet = now;
            Brightness.setBrightnessAsync(v).catch(() => {});
          }
        } else {
          volume.current = v;
          player.volume = v;
          player.muted = v === 0;
        }
        setHud({ kind: swipe.current.kind, value: v });
        hudOpacity.value = withTiming(1, { duration: 100 });
      },
      onPanResponderRelease: (e, g) => {
        const L = live.current;
        if (swipe.current.active) {
          if (swipe.current.kind === 'bright') Brightness.setBrightnessAsync(brightness.current).catch(() => {});
          hudOpacity.value = withTiming(0, { duration: 450 });
          swipe.current.active = false;
          return;
        }
        if (Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10) return;
        const side: 'left' | 'right' = e.nativeEvent.locationX < L.size.w / 2 ? 'left' : 'right';
        const now = Date.now();
        if (now - tap.current.t < 260 && tap.current.side === side) {
          // Double-tap: skip 10s on that side.
          if (tap.current.timer) clearTimeout(tap.current.timer);
          tap.current.t = 0;
          L.seekBy(side === 'left' ? -10 : 10);
          setRipple((r) => ({ side, n: r?.side === side ? r.n + 1 : 1 }));
          return;
        }
        tap.current.t = now;
        tap.current.side = side;
        tap.current.timer = setTimeout(() => {
          tap.current.t = 0;
          if (live.current.shown) live.current.hideControls();
          else live.current.showControls(live.current.playing);
        }, 260);
      },
    })
  ).current;

  return (
    <View
      style={styles.screen}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setArea((a) => (a && a.w === width && a.h === height ? a : { w: width, h: height }));
      }}
    >
      {/* Ambient glow behind the inline player */}
      {ambient && demo.thumb && !full ? (
        <Animated.View key={demo.key} entering={FadeIn.duration(500)} exiting={FadeOut.duration(250)} style={[styles.ambient, { height: insets.top + inlineH + 140 }]} pointerEvents="none">
          <View style={[StyleSheet.absoluteFill, { opacity: 0.9 }]}>
            <Image source={{ uri: demo.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={60} />
            <LinearGradient colors={['rgba(0,0,0,0.2)', colors.bg]} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
          </View>
        </Animated.View>
      ) : null}

      {/* Space the inline player occupies; the list sits below it. */}
      <View style={{ height: insets.top + inlineH }} />
      <ScrollView style={full ? styles.hidden : undefined} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 18 }}>
        <Animated.View key={demo.key} entering={FadeIn.duration(300)}>
          <Text style={styles.nowTitle}>{demo.title}</Text>
          <Text style={styles.nowSub}>{demo.sub}</Text>
        </Animated.View>
        <View style={styles.tips}>
          <Tip icon="fullscreen" text="Fullscreen: swipe up/down on the left for brightness, on the right for volume" />
          <Tip icon="forward10" text="Double-tap the left or right side to skip 10 seconds" />
          <Tip icon="aspectRatio" text="View: Fit, Fill or Stretch, and ambient glow" />
        </View>
        <Text style={styles.listHead}>Demo videos</Text>
        {DEMOS.map((d) => {
          const on = d.key === demo.key;
          return (
            <PressableScale key={d.key} onPress={() => switchTo(d)} style={[styles.demoRow, on && styles.demoOn]} scaleTo={0.98}>
              <View style={styles.demoThumb}>{d.thumb ? <Image source={{ uri: d.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name="play" size={18} color="#fff" />}</View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.demoTitle, on && { color: colors.accent }]}>{d.title}</Text>
                <Text style={styles.demoSub}>{d.sub}</Text>
              </View>
              {on ? <EqBars active={playing} /> : null}
            </PressableScale>
          );
        })}
        <Text style={styles.note}>Player 2.1 is a preview. It plays openly licensed demo videos only.</Text>
      </ScrollView>


      {/* Video layer: one element, never rebuilt; it is just resized with the screen. */}
      <View style={[styles.videoLayer, box]} pointerEvents="none">
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} surfaceType="textureView" />
      </View>

      {/* Controls layer, on top of the video. */}
      <Animated.View style={[styles.overlay, box, overlayAnim]}>

        {status === 'loading' ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : null}
        {status === 'error' ? (
          <View style={styles.center} pointerEvents="none">
            <Text style={styles.errorText}>This video couldn’t be played.</Text>
          </View>
        ) : null}

        <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />

        {ripple ? <SkipRipple side={ripple.side} n={ripple.n} /> : null}

        {hud ? (
          <Animated.View style={[styles.hud, hudStyle]} pointerEvents="none">
            {hud.kind === 'bright' ? <SunIcon level={hud.value} /> : <VolumeIcon level={hud.value} />}
            <View style={styles.hudBar}>
              <View style={[styles.hudFill, { height: `${Math.round(hud.value * 100)}%` }]} />
            </View>
            <Text style={styles.hudText}>{Math.round(hud.value * 100)}</Text>
          </Animated.View>
        ) : null}

        <Animated.View style={[StyleSheet.absoluteFill, controlsStyle]} pointerEvents={shown ? 'box-none' : 'none'}>
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.6)', 'transparent', 'transparent', 'rgba(0,0,0,0.75)']} locations={[0, 0.3, 0.6, 1]} style={StyleSheet.absoluteFill} />

          <View style={[styles.topRow, full && styles.topRowFull, full && { paddingLeft: Math.max(24, insets.left), paddingRight: Math.max(24, insets.right) }]} pointerEvents="box-none">
            <CtrlButton icon={full ? 'down' : 'left'} label={full ? 'Exit fullscreen' : 'Back'} onPress={() => (full ? setFullscreen(false) : router.back())} />
            <Text style={[styles.videoTitle, full && { fontSize: 16 }]} numberOfLines={1}>
              {demo.title}
            </Text>
            <PressableScale onPress={() => setSpeedOpen(true)} style={styles.chip} accessibilityLabel="Playback speed">
              <Text style={styles.chipText}>{rate}×</Text>
            </PressableScale>
            <CtrlButton icon="aspectRatio" label="View options" onPress={() => setViewOpen(true)} />
          </View>

          <View style={styles.centerRow} pointerEvents="box-none">
            <SpinButton icon="rewind10" label="Back 10 seconds" dir={-1} onPress={() => seekBy(-10)} />
            <Animated.View style={popStyle}>
              <Pressable onPress={togglePlay} style={styles.playBtn} accessibilityLabel={playing ? 'Pause' : 'Play'}>
                <Icon name={playing ? 'pause' : 'play'} size={34} color="#fff" />
              </Pressable>
            </Animated.View>
            <SpinButton icon="forward10" label="Forward 10 seconds" dir={1} onPress={() => seekBy(10)} />
          </View>

          <View style={[styles.bottomRow, full && styles.bottomRowFull, full && { paddingLeft: Math.max(28, insets.left), paddingRight: Math.max(28, insets.right) }]} pointerEvents="box-none">
            <SeekBar
              time={time}
              duration={duration}
              buffered={buffered}
              full={full}
              onScrubStart={() => showControls(false)}
              onSeek={(t) => {
                player.currentTime = t;
                setTime(t);
                showControls(playing);
              }}
            />
            <View style={styles.timeRow}>
              <Text style={styles.time}>
                {fmt(time)} <Text style={styles.timeDim}>/ {fmt(duration)}</Text>
              </Text>
              <CtrlButton icon={full ? 'exitFullscreen' : 'fullscreen'} label={full ? 'Exit fullscreen' : 'Fullscreen'} onPress={() => setFullscreen(!full)} />
            </View>
          </View>
        </Animated.View>

        {/* Fullscreen options: a side panel inside the player. */}
        {full && (speedOpen || viewOpen) ? (
          <>
            <Pressable style={styles.panelScrim} onPress={() => (setSpeedOpen(false), setViewOpen(false))} accessibilityLabel="Close" />
            <Animated.View entering={SlideInRight.duration(260)} exiting={SlideOutRight.duration(200)} style={styles.panel}>
              {speedOpen ? (
                <>
                  <Text style={styles.panelHead}>Playback speed</Text>
                  <View style={styles.panelChips}>
                    {SPEEDS.map((sp) => {
                      const on = sp === rate;
                      return (
                        <PressableScale key={sp} onPress={() => chooseRate(sp)} style={[styles.panelChip, on && styles.speedOn]} scaleTo={0.95}>
                          <Text style={[styles.speedText, on && styles.speedTextOn]}>{sp === 1 ? 'Normal' : `${sp}×`}</Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.panelHead}>View</Text>
                  <View style={styles.panelChips}>
                    {FITS.map((fo) => {
                      const on = fo.key === fit;
                      return (
                        <PressableScale key={fo.key} onPress={() => setFit(fo.key)} style={[styles.panelChip, on && styles.speedOn]} scaleTo={0.95}>
                          <Text style={[styles.speedText, on && styles.speedTextOn]}>{fo.label}</Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                  <Text style={styles.panelHint}>{FITS.find((fo) => fo.key === fit)?.hint}</Text>
                </>
              )}
            </Animated.View>
          </>
        ) : null}
      </Animated.View>

      <BottomSheet visible={viewOpen && !full} onClose={() => setViewOpen(false)} title="View" subtitle="How the picture fills the player">
        <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          {FITS.map((f) => {
            const on = f.key === fit;
            return (
              <PressableScale key={f.key} haptic onPress={() => setFit(f.key)} style={[styles.sheetRow, on && styles.sheetRowOn]} scaleTo={0.98}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetText, on && { color: colors.accent }]}>{f.label}</Text>
                  <Text style={styles.sheetSub}>{f.hint}</Text>
                </View>
                {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
              </PressableScale>
            );
          })}
          <PressableScale haptic onPress={() => setAmbient(!ambient)} style={styles.sheetRow} scaleTo={0.98}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetText}>Ambient glow</Text>
              <Text style={styles.sheetSub}>Soft colour from the video behind the player</Text>
            </View>
            <View style={[styles.toggle, ambient && styles.toggleOn]}>
              <View style={[styles.knob, ambient && styles.knobOn]} />
            </View>
          </PressableScale>
        </View>
      </BottomSheet>
      <BottomSheet visible={speedOpen && !full} onClose={() => setSpeedOpen(false)} title="Playback speed">
        <View style={styles.speedGrid}>
          {SPEEDS.map((s) => {
            const on = s === rate;
            return (
              <PressableScale key={s} haptic onPress={() => chooseRate(s)} style={[styles.speed, on && styles.speedOn]} scaleTo={0.95}>
                <Text style={[styles.speedText, on && styles.speedTextOn]}>{s === 1 ? 'Normal' : `${s}×`}</Text>
              </PressableScale>
            );
          })}
        </View>
      </BottomSheet>
    </View>
  );
}

// ---------- Pieces ----------

function CtrlButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.ctrl} hitSlop={8} accessibilityLabel={label}>
      <Icon name={icon} size={22} color="#fff" />
    </PressableScale>
  );
}

function SpinButton({ icon, label, dir, onPress }: { icon: IconName; label: string; dir: 1 | -1; onPress: () => void }) {
  const r = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <Pressable
      onPress={() => {
        r.value = withSequence(withTiming(dir * 40, { duration: 130 }), withSpring(0, springs.bouncy));
        onPress();
      }}
      style={styles.skipBtn}
      accessibilityLabel={label}
    >
      <Animated.View style={style}>
        <Icon name={icon} size={30} color="#fff" />
      </Animated.View>
    </Pressable>
  );
}

// Seek bar. Positions come from the player's own frame (locationX), so it works
// the same whether the player is upright or turned for fullscreen.
function SeekBar({
  time,
  duration,
  buffered,
  full,
  onScrubStart,
  onSeek,
}: {
  time: number;
  duration: number;
  buffered: number;
  full: boolean;
  onScrubStart: () => void;
  onSeek: (t: number) => void;
}) {
  const [w, setW] = useState(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const grow = useSharedValue(0);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + grow.value * 0.6 }] }));
  const live = useRef({ w, duration, onSeek, onScrubStart, full });
  live.current = { w, duration, onSeek, onScrubStart, full };
  const start = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        live.current.onScrubStart();
        grow.value = withSpring(1, springs.press);
        start.current = clamp(e.nativeEvent.locationX / live.current.w);
        setScrub(start.current);
      },
      onPanResponderMove: (_, g) => {
        const d = g.dx;
        setScrub(clamp(start.current + d / live.current.w));
      },
      onPanResponderRelease: (_, g) => {
        const d = g.dx;
        const p = clamp(start.current + d / live.current.w);
        grow.value = withSpring(0, springs.press);
        setScrub(null);
        if (live.current.duration) live.current.onSeek(p * live.current.duration);
      },
    })
  ).current;
  const p = scrub ?? (duration ? time / duration : 0);
  const b = duration ? Math.min(1, buffered / duration) : 0;
  return (
    <View style={styles.seekWrap} onLayout={(e: LayoutChangeEvent) => setW(Math.max(1, e.nativeEvent.layout.width))} {...pan.panHandlers}>
      {scrub != null ? (
        <View style={[styles.bubble, { left: Math.min(Math.max(0, p * w - 30), w - 60) }]}>
          <Text style={styles.bubbleText}>{fmt(p * duration)}</Text>
        </View>
      ) : null}
      <View style={styles.track}>
        <View style={[styles.buffer, { width: `${b * 100}%` }]} />
        <View style={[styles.played, { width: `${p * 100}%` }]} />
      </View>
      <Animated.View style={[styles.thumb, { left: p * w - 7 }, thumbStyle]} />
    </View>
  );
}

function SkipRipple({ side, n }: { side: 'left' | 'right'; n: number }) {
  return (
    <Animated.View
      key={`${side}-${n}`}
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(280)}
      style={[styles.ripple, side === 'left' ? styles.rippleLeft : styles.rippleRight]}
      pointerEvents="none"
    >
      <Icon name={side === 'left' ? 'rewind10' : 'forward10'} size={30} color="#fff" />
      <Text style={styles.rippleText}>
        {side === 'left' ? '−' : '+'}
        {n * 10}s
      </Text>
    </Animated.View>
  );
}

// Sun that grows and gains rays with brightness.
function SunIcon({ level }: { level: number }) {
  const rays = 4 + Math.round(level * 4);
  const r = 4 + level * 3;
  const len = 2 + level * 3;
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      <Circle cx={17} cy={17} r={r} fill="#fff" />
      {Array.from({ length: rays }, (_, i) => {
        const a = (i / rays) * Math.PI * 2;
        const x1 = 17 + Math.cos(a) * (r + 2.5);
        const y1 = 17 + Math.sin(a) * (r + 2.5);
        return <Line key={i} x1={x1} y1={y1} x2={x1 + Math.cos(a) * len} y2={y1 + Math.sin(a) * len} stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />;
      })}
    </Svg>
  );
}

// Speaker with 0–3 waves, or a cross when muted.
function VolumeIcon({ level }: { level: number }) {
  const waves = level === 0 ? 0 : level < 0.34 ? 1 : level < 0.67 ? 2 : 3;
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      <Path d="M6 13h5l7-6v20l-7-6H6z" fill="#fff" />
      {level === 0 ? (
        <>
          <Line x1={22} y1={13} x2={30} y2={21} stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
          <Line x1={30} y1={13} x2={22} y2={21} stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        </>
      ) : (
        [1, 2, 3].slice(0, waves).map((i) => (
          <Path key={i} d={`M${19 + i * 3.6} ${17 - i * 3.4} a${i * 4.5} ${i * 4.5} 0 0 1 0 ${i * 6.8}`} fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" />
        ))
      )}
    </Svg>
  );
}

function EqBars({ active }: { active: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 16 }}>
      {[0, 1, 2].map((i) => (
        <EqBar key={i} i={i} active={active} />
      ))}
    </View>
  );
}
function EqBar({ i, active }: { i: number; active: boolean }) {
  const h = useSharedValue(0.4);
  useEffect(() => {
    if (!active) {
      h.value = withTiming(0.3, { duration: 200 });
      return;
    }
    const tick = () => (h.value = withTiming(0.25 + Math.random() * 0.75, { duration: 260 + i * 60 }));
    tick();
    const t = setInterval(tick, 300 + i * 60);
    return () => clearInterval(t);
  }, [active, h, i]);
  const style = useAnimatedStyle(() => ({ height: `${h.value * 100}%` }));
  return <Animated.View style={[{ width: 3, borderRadius: 2, backgroundColor: colors.accent }, style]} />;
}

function Tip({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.tip}>
      <Icon name={icon} size={16} color={colors.accent} />
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  ambient: { position: 'absolute', top: 0, left: 0, right: 0 },
  hidden: { display: 'none' },
  videoLayer: { position: 'absolute', backgroundColor: '#000' },
  overlay: { position: 'absolute', overflow: 'hidden' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },

  topRow: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingTop: 8 },
  topRowFull: { paddingHorizontal: 24, paddingTop: 16 },
  videoTitle: { flex: 1, color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  ctrl: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', justifyContent: 'center' },
  chipText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },

  centerRow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 46 },
  playBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  skipBtn: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },

  bottomRow: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: 4 },
  bottomRowFull: { paddingHorizontal: 28, paddingBottom: 16 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5, fontVariant: ['tabular-nums'] },
  timeDim: { color: 'rgba(255,255,255,0.6)', fontFamily: fonts.regular },

  seekWrap: { height: 28, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  buffer: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(255,255,255,0.35)' },
  played: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.accent },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: colors.accent, borderWidth: 2, borderColor: '#fff' },
  bubble: { position: 'absolute', bottom: 30, width: 60, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' },
  bubbleText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12, fontVariant: ['tabular-nums'] },

  hud: { position: 'absolute', alignSelf: 'center', top: '20%', width: 84, paddingVertical: 14, borderRadius: 22, backgroundColor: 'rgba(15,15,20,0.82)', alignItems: 'center', gap: 10 },
  hudBar: { width: 6, height: 70, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden', justifyContent: 'flex-end' },
  hudFill: { width: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  hudText: { color: '#fff', fontFamily: fonts.black, fontSize: 13, fontVariant: ['tabular-nums'] },

  ripple: { position: 'absolute', top: 0, bottom: 0, width: '38%', backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  rippleLeft: { left: 0, borderTopRightRadius: 999, borderBottomRightRadius: 999 },
  rippleRight: { right: 0, borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
  rippleText: { color: '#fff', fontFamily: fonts.black, fontSize: 13 },

  nowTitle: { color: '#fff', fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.5 },
  nowSub: { color: colors.text2, fontFamily: fonts.regular, fontSize: 13.5, marginTop: 4 },
  tips: { gap: 10, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tipText: { flex: 1, color: colors.text2, fontFamily: fonts.regular, fontSize: 13 },
  listHead: { color: '#fff', fontFamily: fonts.black, fontSize: 16 },
  demoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md },
  demoOn: { backgroundColor: 'rgba(255,100,10,0.08)' },
  demoThumb: { width: 96, height: 54, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  demoTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 14.5 },
  demoSub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  note: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, textAlign: 'center', marginTop: 6 },

  panelScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: { position: 'absolute', top: 0, right: 0, bottom: 0, width: 300, paddingHorizontal: 20, paddingTop: 26, gap: 14, backgroundColor: 'rgba(14,15,20,0.96)', borderTopLeftRadius: 20, borderBottomLeftRadius: 20 },
  panelHead: { color: '#fff', fontFamily: fonts.black, fontSize: 17 },
  panelChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  panelChip: { minWidth: 76, height: 42, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  panelHint: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 13, borderRadius: radius.md },
  sheetRowOn: { backgroundColor: 'rgba(255,100,10,0.08)' },
  sheetText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  sheetSub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surface3, padding: 3 },
  toggleOn: { backgroundColor: colors.accent },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  knobOn: { transform: [{ translateX: 18 }] },
  speedGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 18, paddingBottom: 10 },
  speed: { width: '30%', flexGrow: 1, height: 48, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  speedOn: { backgroundColor: colors.accent },
  speedText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  speedTextOn: { color: '#000' },
});
