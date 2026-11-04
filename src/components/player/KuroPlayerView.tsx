import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  Modal,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  PanResponder,
  Platform,
  BackHandler,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useVideoPlayer, VideoView } from 'expo-video';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

// ============================================================================
// KURO SVG ICONS (Exact match for Lucide icons in Kuro)
// ============================================================================
function KuroIcon({ name, size = 24, color = '#FFFFFF', strokeWidth = 2 }: { name: string; size?: number; color?: string; strokeWidth?: number }) {
  switch (name) {
    case 'arrowLeft':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M19 12H5M12 19l-7-7 7-7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'settings':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={strokeWidth} />
          <Path
            d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
            stroke={color}
            strokeWidth={strokeWidth}
          />
        </Svg>
      );
    case 'play':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M6 4l15 8-15 8V4z" fill={color} />
        </Svg>
      );
    case 'pause':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
          <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
        </Svg>
      );
    case 'rotateCcw':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M3 3v5h5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'rotateCw':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M21 12a9 9 0 11-9-9 9.75 9.75 0 016.74 2.74L21 8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M21 3v5h-5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'subtitles':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x="3" y="5" width="18" height="14" rx="2" stroke={color} strokeWidth={strokeWidth} />
          <Path d="M7 15h4M15 15h2M7 11h2M13 11h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
        </Svg>
      );
    case 'maximize':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'minimize':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'close':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M18 6L6 18M6 6l12 12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    case 'check':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      );
    default:
      return null;
  }
}

const formatTime = (seconds: number) => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// ============================================================================
// KURO MODAL MENU (Slide up in portrait, Right-side sheet in landscape)
// ============================================================================
const ModalMenu = ({ visible, onClose, title, isLandscape, children }: any) => (
  <Modal visible={visible} transparent animationType={isLandscape ? 'fade' : 'slide'} onRequestClose={onClose}>
    <View style={[styles.modalRoot, isLandscape ? styles.modalRootLandscape : styles.modalRootPortrait]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalBackdrop} />
      </TouchableOpacity>
      <View style={[styles.modalContent, isLandscape ? styles.modalContentLandscape : styles.modalContentPortrait]}>
        {!isLandscape && (
          <View style={styles.sheetHandleWrap}>
            <View style={styles.sheetHandle} />
          </View>
        )}
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
            <KuroIcon name="close" size={20} color="#a1a1aa" />
          </TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <TouchableOpacity activeOpacity={1}>{children}</TouchableOpacity>
        </ScrollView>
      </View>
    </View>
  </Modal>
);

// ============================================================================
// KURO CUSTOM TIMELINE SCRUBBER (With Intro/Outro segment highlights)
// ============================================================================
function KuroScrubber({
  currentTime,
  duration,
  intro,
  outro,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
  onSeek: (time: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(1);
  const [scrubbingVal, setScrubbingVal] = useState<number | null>(null);

  const displayTime = scrubbingVal !== null ? scrubbingVal : currentTime;
  const progressPercent = duration > 0 ? Math.max(0, Math.min(100, (displayTime / duration) * 100)) : 0;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const touchX = evt.nativeEvent.locationX;
          const ratio = Math.max(0, Math.min(1, touchX / (trackWidth || 1)));
          setScrubbingVal(ratio * duration);
        },
        onPanResponderMove: (evt) => {
          const touchX = evt.nativeEvent.locationX;
          const ratio = Math.max(0, Math.min(1, touchX / (trackWidth || 1)));
          setScrubbingVal(ratio * duration);
        },
        onPanResponderRelease: (evt) => {
          const touchX = evt.nativeEvent.locationX;
          const ratio = Math.max(0, Math.min(1, touchX / (trackWidth || 1)));
          const target = ratio * duration;
          setScrubbingVal(null);
          onSeek(target);
        },
      }),
    [trackWidth, duration, onSeek]
  );

  return (
    <View
      style={styles.scrubberContainer}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      {...panResponder.panHandlers}
    >
      <View style={styles.scrubberTrack}>
        {/* Intro Highlight Marker */}
        {intro && intro.end > 0 && duration > 0 && (
          <View
            style={[
              styles.markerHighlight,
              {
                left: `${(intro.start / duration) * 100}%`,
                width: `${Math.max(2, ((intro.end - intro.start) / duration) * 100)}%`,
              },
            ]}
          />
        )}
        {/* Outro Highlight Marker */}
        {outro && outro.end > 0 && duration > 0 && (
          <View
            style={[
              styles.markerHighlight,
              {
                left: `${(outro.start / duration) * 100}%`,
                width: `${Math.max(2, ((outro.end - outro.start) / duration) * 100)}%`,
              },
            ]}
          />
        )}
        {/* Active Progress Fill */}
        <View style={[styles.scrubberFill, { width: `${progressPercent}%` }]} />
      </View>
      {/* Thumb Handle */}
      <View style={[styles.scrubberThumb, { left: `${progressPercent}%` }]} />
    </View>
  );
}

// ============================================================================
// KURO BOTTOM CONTROLS
// ============================================================================
const KuroBottomControls = ({
  player,
  duration,
  isLandscape,
  setShowSubs,
  setShowSettings,
  toggleOrientation,
  intro,
  outro,
}: any) => {
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      if (player) {
        setCurrentTime(player.currentTime || 0);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [player]);

  const handleSeek = useCallback(
    (target: number) => {
      if (player) {
        player.currentTime = target;
        setCurrentTime(target);
      }
    },
    [player]
  );

  return (
    <View
      style={[
        styles.bottomControlsWrap,
        isLandscape ? styles.bottomControlsLandscape : styles.bottomControlsPortrait,
      ]}
      pointerEvents="box-none"
    >
      {isLandscape && (
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.92)']}
          style={styles.bottomGradient}
          pointerEvents="none"
        />
      )}

      {/* Landscape Scrubber Row */}
      {isLandscape && (
        <View style={styles.scrubberRow}>
          <KuroScrubber
            currentTime={currentTime}
            duration={duration}
            intro={intro}
            outro={outro}
            onSeek={handleSeek}
          />
        </View>
      )}

      {/* Timestamp & Action Buttons Row */}
      <View style={styles.bottomMetaRow} pointerEvents="box-none">
        <View pointerEvents="none" style={isLandscape ? { marginBottom: 4 } : undefined}>
          <Text style={[styles.timeText, isLandscape ? styles.timeTextLandscape : styles.timeTextPortrait]}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </Text>
        </View>

        <View style={styles.bottomActionsRow} pointerEvents="box-none">
          <TouchableOpacity onPress={() => setShowSubs(true)} style={styles.iconHitSlop}>
            <KuroIcon name="subtitles" size={isLandscape ? 28 : 22} color="white" strokeWidth={1.5} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleOrientation} style={styles.iconHitSlop}>
            <KuroIcon name={isLandscape ? 'minimize' : 'maximize'} size={isLandscape ? 28 : 22} color="white" strokeWidth={1.5} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Portrait Scrubber Row */}
      {!isLandscape && (
        <View style={styles.scrubberRowPortrait}>
          <KuroScrubber
            currentTime={currentTime}
            duration={duration}
            intro={intro}
            outro={outro}
            onSeek={handleSeek}
          />
        </View>
      )}
    </View>
  );
};

// ============================================================================
// MAIN KURO PLAYER COMPONENT
// ============================================================================
export interface KuroPlayerProps {
  streamUrl: string;
  animeTitle?: string;
  episodeNumber?: number | string;
  episodeTitle?: string;
  subtitles?: Array<{ lang: string; url: string }>;
  intro?: { start: number; end: number } | null;
  outro?: { start: number; end: number } | null;
  onBack?: () => void;
}

export function KuroPlayerView({
  streamUrl,
  animeTitle = 'Demon Slayer: Kimetsu no Yaiba',
  episodeNumber = 1,
  episodeTitle = 'Cruelty',
  subtitles = [
    { lang: 'English', url: 'https://example.com/sub_en.vtt' },
    { lang: 'Spanish', url: 'https://example.com/sub_es.vtt' },
  ],
  intro = { start: 90, end: 180 },
  outro = { start: 1350, end: 1440 },
  onBack,
}: KuroPlayerProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [isPlaying, setIsPlaying] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const [duration, setDuration] = useState(1440);
  const [showSettings, setShowSettings] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [selectedSubIdx, setSelectedSubIdx] = useState(0); // 0 = English
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [autoSkipIntro, setAutoSkipIntro] = useState(true);
  const [autoNext, setAutoNext] = useState(true);

  // Ripple indicator for double tap
  const [seekRipple, setSeekRipple] = useState<{ visible: boolean; side: 'left' | 'right'; text: string }>({
    visible: false,
    side: 'right',
    text: '',
  });
  const rippleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ time: number; side: string } | null>(null);
  const controlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Expo Video Player
  const player = useVideoPlayer(streamUrl, (instance) => {
    instance.loop = false;
    instance.bufferOptions = {
      preferredForwardBufferDuration: 60,
      waitsToMinimizeStalling: false,
      minBufferForPlayback: 1.5,
      maxBufferBytes: 0,
    };
    instance.play();
  });

  // Track playback status & duration
  useEffect(() => {
    if (!player) return;
    const subPlay = player.addListener('playingChange', (payload) => {
      setIsPlaying(payload.isPlaying);
    });
    const subStatus = player.addListener('statusChange', (payload) => {
      if (player.duration > 0) {
        setDuration(player.duration);
      }
      setIsBuffering(payload.status === 'loading');
    });

    return () => {
      subPlay.remove();
      subStatus.remove();
    };
  }, [player]);

  // Auto-hide controls after 3.5s of inactivity
  const resetControlsTimer = useCallback(() => {
    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    if (isPlaying) {
      controlsTimeout.current = setTimeout(() => {
        setShowControls(false);
      }, 3500);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (showControls) resetControlsTimer();
    return () => {
      if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    };
  }, [showControls, resetControlsTimer]);

  const togglePlay = useCallback(() => {
    if (!player) return;
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
    resetControlsTimer();
  }, [player, isPlaying, resetControlsTimer]);

  const seek = useCallback(
    (secondsDelta: number) => {
      if (!player) return;
      const cur = player.currentTime || 0;
      const target = Math.max(0, Math.min(duration, cur + secondsDelta));
      player.currentTime = target;
      resetControlsTimer();
    },
    [player, duration, resetControlsTimer]
  );

  const showSeekRipple = (side: 'left' | 'right', text: string) => {
    setSeekRipple({ visible: true, side, text });
    if (rippleTimeout.current) clearTimeout(rippleTimeout.current);
    rippleTimeout.current = setTimeout(() => {
      setSeekRipple((prev) => ({ ...prev, visible: false }));
    }, 600);
  };

  // Kuro Double-tap & Tap handler
  const handleVideoPress = (e: any) => {
    const { locationX } = e.nativeEvent;
    const screenWidth = isLandscape ? Math.max(width, height) : Math.min(width, height);

    let side = 'center';
    if (locationX < screenWidth * 0.3) side = 'left';
    else if (locationX > screenWidth * 0.7) side = 'right';

    const now = Date.now();
    if (lastTap.current && lastTap.current.side === side && side !== 'center' && now - lastTap.current.time < 300) {
      if (side === 'left') {
        seek(-10);
        showSeekRipple('left', '-10s');
      } else if (side === 'right') {
        seek(10);
        showSeekRipple('right', '+10s');
      }
      lastTap.current = null;
    } else {
      lastTap.current = { time: now, side };
      setShowControls((prev) => !prev);
    }
  };

  const toggleOrientation = useCallback(async () => {
    try {
      if (isLandscape) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      }
    } catch {}
  }, [isLandscape]);

  // Hardware Back Button in landscape exits fullscreen first
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isLandscape) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [isLandscape]);

  // Clean unmount orientation restoration
  useEffect(() => {
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  return (
    <View style={[styles.playerContainer, isLandscape ? styles.playerContainerLandscape : styles.playerContainerPortrait]}>
      <StatusBar hidden={isLandscape} style="light" />

      {/* VIDEO VIEW */}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />

      {/* BUFFERING SPINNER */}
      {isBuffering && (
        <View pointerEvents="none" style={styles.centerBufferingWrap}>
          <View style={styles.bufferingCircle}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        </View>
      )}

      {/* DOUBLE TAP GESTURE RECOGNITION SURFACE */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleVideoPress}>
        <View style={[styles.dimmerOverlay, { opacity: showControls ? 1 : 0 }]} />
      </Pressable>

      {/* DOUBLE TAP SEEK RIPPLE */}
      {seekRipple.visible && (
        <View
          pointerEvents="none"
          style={[
            styles.seekRippleWrap,
            seekRipple.side === 'left' ? styles.seekRippleLeft : styles.seekRippleRight,
          ]}
        >
          <View style={styles.seekRippleBadge}>
            <KuroIcon name={seekRipple.side === 'left' ? 'rotateCcw' : 'rotateCw'} size={42} color="white" />
            <Text style={styles.seekRippleText}>{seekRipple.text}</Text>
          </View>
        </View>
      )}

      {/* UNIFIED CONTROLS OVERLAY */}
      <View
        style={[styles.controlsOverlay, { opacity: showControls ? 1 : 0 }]}
        pointerEvents={showControls ? 'box-none' : 'none'}
      >
        {/* TOP BAR */}
        <View
          style={[
            styles.topBar,
            isLandscape ? { paddingHorizontal: 24, paddingTop: Math.max(insets.top, 20) } : { padding: 16, paddingTop: Math.max(insets.top, 16) },
          ]}
          pointerEvents="box-none"
        >
          {isLandscape && (
            <LinearGradient
              colors={['rgba(0,0,0,0.85)', 'transparent']}
              style={styles.topGradient}
              pointerEvents="none"
            />
          )}

          <View style={styles.topLeftRow} pointerEvents="box-none">
            <TouchableOpacity
              onPress={onBack}
              style={[styles.backBtn, isLandscape ? styles.backBtnLandscape : styles.backBtnPortrait]}
            >
              <KuroIcon name="arrowLeft" size={isLandscape ? 28 : 24} color="white" />
            </TouchableOpacity>

            {isLandscape && (
              <View style={styles.titleWrap} pointerEvents="none">
                <Text style={styles.animeTitle} numberOfLines={1}>
                  {animeTitle}
                </Text>
                <View style={styles.epMetaRow}>
                  <Text style={styles.epNumText}>Episode {episodeNumber}</Text>
                  {episodeTitle && (
                    <>
                      <View style={styles.bulletDot} />
                      <Text style={styles.epTitleText} numberOfLines={1}>
                        {episodeTitle}
                      </Text>
                    </>
                  )}
                </View>
              </View>
            )}
          </View>

          <View style={styles.topRightRow}>
            {/* Kuro Live Info Tag */}
            <View style={styles.kuroTag}>
              <Text style={styles.kuroTagText}>KURO UI</Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowSettings(true)}
              style={[styles.backBtn, isLandscape ? styles.backBtnLandscape : styles.backBtnPortrait]}
            >
              <KuroIcon name="settings" size={isLandscape ? 26 : 24} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* CENTER PLAY/PAUSE & ±10s BUTTONS */}
        <View style={[styles.centerPlayRow, { gap: isLandscape ? 48 : 32 }]} pointerEvents="box-none">
          <TouchableOpacity onPress={() => seek(-10)} style={styles.skipBtn}>
            <KuroIcon name="rotateCcw" size={isLandscape ? 40 : 34} color="rgba(255,255,255,0.95)" strokeWidth={2} />
          </TouchableOpacity>

          {/* Kuro Signature Glassmorphic Center Play/Pause Button */}
          <TouchableOpacity onPress={togglePlay} style={styles.playPauseCircle}>
            <KuroIcon name={isPlaying ? 'pause' : 'play'} size={34} color="#FFFFFF" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => seek(10)} style={styles.skipBtn}>
            <KuroIcon name="rotateCw" size={isLandscape ? 40 : 34} color="rgba(255,255,255,0.95)" strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* BOTTOM CONTROLS */}
        <KuroBottomControls
          player={player}
          duration={duration}
          isLandscape={isLandscape}
          setShowSubs={setShowSubs}
          setShowSettings={setShowSettings}
          toggleOrientation={toggleOrientation}
          intro={intro}
          outro={outro}
        />
      </View>

      {/* SETTINGS MODAL */}
      <ModalMenu
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        title="Playback Settings"
        isLandscape={isLandscape}
      >
        <View style={styles.settingsSection}>
          <Text style={styles.settingsLabel}>Playback Speed</Text>
          <View style={styles.speedOptionsWrap}>
            {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => (
              <TouchableOpacity
                key={spd}
                onPress={() => {
                  setPlaybackSpeed(spd);
                  if (player) player.playbackRate = spd;
                }}
                style={[styles.speedChip, playbackSpeed === spd && styles.speedChipActive]}
              >
                <Text style={[styles.speedChipText, playbackSpeed === spd && styles.speedChipTextActive]}>
                  {spd}x
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.settingsSection}>
          <Text style={styles.settingsLabel}>Automation</Text>
          <TouchableOpacity
            onPress={() => setAutoSkipIntro(!autoSkipIntro)}
            style={styles.toggleRow}
          >
            <Text style={styles.toggleText}>Auto-Skip Opening</Text>
            {autoSkipIntro && <KuroIcon name="check" size={20} color="#FFFFFF" />}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setAutoNext(!autoNext)}
            style={styles.toggleRow}
          >
            <Text style={styles.toggleText}>Auto-Play Next Episode</Text>
            {autoNext && <KuroIcon name="check" size={20} color="#FFFFFF" />}
          </TouchableOpacity>
        </View>
      </ModalMenu>

      {/* SUBTITLES MODAL */}
      <ModalMenu
        visible={showSubs}
        onClose={() => setShowSubs(false)}
        title="Subtitles & CC"
        isLandscape={isLandscape}
      >
        <TouchableOpacity
          onPress={() => {
            setSelectedSubIdx(-1);
            setShowSubs(false);
          }}
          style={[styles.subRow, selectedSubIdx === -1 && styles.subRowActive]}
        >
          <Text style={[styles.subText, selectedSubIdx === -1 && styles.subTextActive]}>Off</Text>
          {selectedSubIdx === -1 && <KuroIcon name="check" size={20} color="white" />}
        </TouchableOpacity>

        {subtitles.map((sub, idx) => (
          <TouchableOpacity
            key={sub.lang}
            onPress={() => {
              setSelectedSubIdx(idx);
              setShowSubs(false);
            }}
            style={[styles.subRow, selectedSubIdx === idx && styles.subRowActive]}
          >
            <Text style={[styles.subText, selectedSubIdx === idx && styles.subTextActive]}>{sub.lang}</Text>
            {selectedSubIdx === idx && <KuroIcon name="check" size={20} color="white" />}
          </TouchableOpacity>
        ))}
      </ModalMenu>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  playerContainer: {
    backgroundColor: '#000000',
    overflow: 'hidden',
    position: 'relative',
  },
  playerContainerPortrait: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  playerContainerLandscape: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 999,
  },
  dimmerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  controlsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    zIndex: 20,
  },
  centerBufferingWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
  },
  bufferingCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekRippleWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '45%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    zIndex: 18,
  },
  seekRippleLeft: {
    left: 0,
    borderTopRightRadius: 100,
    borderBottomRightRadius: 100,
  },
  seekRippleRight: {
    right: 0,
    borderTopLeftRadius: 100,
    borderBottomLeftRadius: 100,
  },
  seekRippleBadge: {
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 999,
    alignItems: 'center',
  },
  seekRippleText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
    marginTop: 6,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    zIndex: 25,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  topLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  topRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnPortrait: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  backBtnLandscape: {
    padding: 8,
  },
  titleWrap: {
    marginLeft: 12,
    flex: 1,
  },
  animeTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 6,
  },
  epMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  epNumText: {
    color: '#E4E4E7',
    fontSize: 13,
    fontWeight: '600',
  },
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#A1A1AA',
  },
  epTitleText: {
    color: '#D4D4D8',
    fontSize: 13,
    flex: 1,
  },
  kuroTag: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  kuroTagText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  centerPlayRow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 22,
  },
  skipBtn: {
    padding: 16,
    borderRadius: 999,
  },
  playPauseCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomControlsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 25,
    width: '100%',
  },
  bottomControlsPortrait: {
    bottom: 8,
    paddingHorizontal: 14,
  },
  bottomControlsLandscape: {
    bottom: 0,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  bottomMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  bottomActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  iconHitSlop: {
    padding: 8,
  },
  timeText: {
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 4,
  },
  timeTextPortrait: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  timeTextLandscape: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 14,
  },
  scrubberRow: {
    width: '100%',
    height: 36,
    justifyContent: 'center',
    marginBottom: -4,
  },
  scrubberRowPortrait: {
    width: '100%',
    height: 32,
    justifyContent: 'center',
    marginTop: -4,
  },
  scrubberContainer: {
    height: 32,
    justifyContent: 'center',
    position: 'relative',
  },
  scrubberTrack: {
    height: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2.5,
    overflow: 'hidden',
    position: 'relative',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 2.5,
  },
  scrubberThumb: {
    position: 'absolute',
    top: '50%',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    marginLeft: -7,
    marginTop: -7,
    elevation: 3,
  },
  markerHighlight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 2,
    zIndex: 5,
  },
  modalRoot: {
    flex: 1,
  },
  modalRootPortrait: {
    justifyContent: 'flex-end',
  },
  modalRootLandscape: {
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  modalContent: {
    backgroundColor: '#18181B',
    borderColor: '#27272A',
  },
  modalContentPortrait: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    paddingBottom: 36,
    paddingTop: 16,
    paddingHorizontal: 20,
    width: '100%',
    maxHeight: '70%',
  },
  modalContentLandscape: {
    width: '45%',
    height: '100%',
    borderLeftWidth: 1,
    padding: 24,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
  },
  sheetHandleWrap: {
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#3F3F46',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  modalCloseBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#27272A',
  },
  settingsSection: {
    marginBottom: 20,
  },
  settingsLabel: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  speedOptionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  speedChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(39, 39, 42, 0.5)',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  speedChipActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  speedChipText: {
    color: '#D4D4D8',
    fontSize: 14,
    fontWeight: '600',
  },
  speedChipTextActive: {
    color: '#FFFFFF',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(39, 39, 42, 0.4)',
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 10,
  },
  toggleText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(39, 39, 42, 0.4)',
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 8,
  },
  subRowActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  subText: {
    color: '#D4D4D8',
    fontSize: 15,
    fontWeight: '600',
  },
  subTextActive: {
    color: '#FFFFFF',
  },
});
