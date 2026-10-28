import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewProps } from 'react-native-webview';
import NativeHlsPlayer, { type NativePlayerTrack, type NativeVideoLevel } from '@/components/player/NativeHlsPlayer';
import { EpisodeBadges } from '@/components/Badges';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { api, toFullUrl } from '@/lib/api';
import { useLibrary } from '@/lib/library';
import { colors, fonts, radius } from '@/lib/theme';
import type { Episode, EpisodesData, StreamData } from '@/lib/types';
import { useFetch } from '@/lib/useFetch';

const MobileWebView = WebView as unknown as React.ComponentType<WebViewProps & { ref?: any }>;

const SERVER_STORAGE_KEY = 'animeverse:preferred_server';
const AUTOPLAY_STORAGE_KEY = 'animeverse:autoplay';
type ServerType = 'vidrift' | 'hianime';
type FitMode = 'contain' | 'cover' | 'fill';
type SettingsSubView = 'main' | 'audio' | 'subtitles' | 'quality' | 'speed';

interface AudioTrackInfo {
  id: number;
  name: string;
  lang: string;
}

interface VideoLevelInfo {
  index: number;
  height: number;
  width: number;
  bitrate: number;
}

// Formats seconds into M:SS or H:MM:SS
function formatDuration(sec: number) {
  if (!sec || isNaN(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sStr = s < 10 ? `0${s}` : `${s}`;
  if (h > 0) {
    const mStr = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${mStr}:${sStr}`;
  }
  return `${m}:${sStr}`;
}

export default function WatchScreen() {
  const { id, season: paramSeason, ep: paramEp } = useLocalSearchParams<{ id: string; season?: string; ep?: string }>();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // Authoritative fullscreen state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Live container layout measurements (avoids pre-rotation Dimensions stale reads)
  const [layoutDimensions, setLayoutDimensions] = useState<{ width: number; height: number }>({
    width: width,
    height: height,
  });

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && h > 0) {
      setLayoutDimensions({ width: Math.round(w), height: Math.round(h) });
    }
  }, []);

  const activeWidth = layoutDimensions.width || width;
  const activeHeight = layoutDimensions.height || height;
  const isPhysicalLandscape = activeWidth > activeHeight;
  // Do not expand the player to the full portrait viewport while the OS is
  // still rotating. Fullscreen presentation follows measured landscape layout.
  const isFullscreenView = isPhysicalLandscape;

  const [currentSeason, setCurrentSeason] = useState<number>(Math.max(1, parseInt(paramSeason || '1', 10) || 1));
  const [currentEp, setCurrentEp] = useState<number>(Math.max(1, parseInt(paramEp || '1', 10) || 1));
  const [server, setServer] = useState<ServerType>('hianime');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(true);
  const [fitMode, setFitMode] = useState<FitMode>('contain'); // Default: contain (100% video visible, no crop)
  const [badgeText, setBadgeText] = useState<string | null>(null);

  // Dynamic Audio Tracks & Quality from Hls.js stream
  const [availableAudioTracks, setAvailableAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [currentAudioTrackId, setCurrentAudioTrackId] = useState<number>(0);
  const [hasInBandAlternateAudio, setHasInBandAlternateAudio] = useState<boolean>(false);
  const [currentLang, setCurrentLang] = useState<'sub' | 'dub'>('sub');
  const [playerPreferencesLoaded, setPlayerPreferencesLoaded] = useState<boolean>(false);
  const [isSwitchingAudio, setIsSwitchingAudio] = useState<boolean>(false);

  const [availableLevels, setAvailableLevels] = useState<VideoLevelInfo[]>([]);
  const [selectedQualityHeight, setSelectedQualityHeight] = useState<number>(-1); // -1: Auto, 1080: 1080p, etc.

  const [hlsStream, setHlsStream] = useState<StreamData | null>(null);
  const [mountedStream, setMountedStream] = useState<StreamData | null>(null);
  const [resolvingHls, setResolvingHls] = useState<boolean>(false);
  const [hlsError, setHlsError] = useState<string | null>(null);

  // Playback states
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [bufferedTime, setBufferedTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(1429); // fallback ~23:49
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [showAdvisory, setShowAdvisory] = useState<boolean>(true);

  // Settings & All Episodes
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsSubView, setSettingsSubView] = useState<SettingsSubView>('main');
  const [allEpisodesOpen, setAllEpisodesOpen] = useState<boolean>(false);

  // Likes / Interactions
  const [liked, setLiked] = useState<boolean>(false);
  const [disliked, setDisliked] = useState<boolean>(false);
  const [likeCount, setLikeCount] = useState<number>(2940);
  const [dislikeCount, setDislikeCount] = useState<number>(18);

  const webViewRef = useRef<any>(null);
  const nativeVideoRef = useRef<any>(null);
  const nativePlayerTimeRef = useRef(0);
  const nativeSourceKeyRef = useRef<string | null>(null);
  const [nativeAudioTrackId, setNativeAudioTrackId] = useState<number | null>(null);
  const [nativeTextTrackId, setNativeTextTrackId] = useState<number | null>(null);
  const [resumeAfterSourceChange, setResumeAfterSourceChange] = useState<{ key: string; time: number; shouldPlay: boolean } | null>(null);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advisoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const initialPinchDistRef = useRef<number | null>(null);
  const { setProgress } = useLibrary();
  const recordedEpRef = useRef<string | null>(null);
  const progressBarWidthRef = useRef<number>(width);

  const mountedStreamEpisodeKeyRef = useRef<string | null>(null);
  const audioSwitchRequestRef = useRef(0);

  // Live state refs to capture values synchronously during stream switches
  const currentTimeRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(true);
  const playbackSpeedRef = useRef<number>(1.0);
  const subtitlesEnabledRef = useRef<boolean>(true);
  const selectedQualityRef = useRef<number>(-1);
  const currentLangRef = useRef<'sub' | 'dub'>('sub');
  const streamCacheRef = useRef<Map<string, { data: StreamData; expiresAt: number }>>(new Map());
  const inflightResolutionsRef = useRef<Map<string, Promise<StreamData>>>(new Map());

  // Load playback preferences together before resolving a stream. Previously
  // the stream resolver could start before the saved server/audio mode arrived,
  // producing avoidable cold-start requests and sometimes choosing the wrong mode.
  useEffect(() => {
    let active = true;
    Promise.all([
      AsyncStorage.getItem('animeverse_lang').catch(() => null),
      AsyncStorage.getItem(SERVER_STORAGE_KEY).catch(() => null),
      AsyncStorage.getItem(AUTOPLAY_STORAGE_KEY).catch(() => null),
    ]).then(([savedLang, savedServer, savedAutoplay]) => {
      if (!active) return;
      if (savedLang === 'dub' || savedLang === 'sub') {
        setCurrentLang(savedLang);
        currentLangRef.current = savedLang;
      }
      if (savedServer === 'hianime' || savedServer === 'vidrift') {
        setServer(savedServer as ServerType);
      }
      if (savedAutoplay !== null) setAutoplay(savedAutoplay === '1');
      setPlayerPreferencesLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Unlock orientation sensor on unmount
  useEffect(() => {
    return () => {
      ScreenOrientation.unlockAsync().catch(() => {});
    };
  }, []);

  // Stale callback protection across episode/stream switches
  const currentEpisodeKeyRef = useRef<string>(`${currentSeason}:${currentEp}`);
  useEffect(() => {
    currentEpisodeKeyRef.current = `${currentSeason}:${currentEp}`;
  }, [currentSeason, currentEp]);

  // Integrated Orientation Control (immediate non-blocking request)
  const enterLandscape = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  const restoreOrientation = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
      .then(() => {
        // Prevent racing: wait for portrait orientation to settle before releasing sensor lock
        setTimeout(() => {
          ScreenOrientation.unlockAsync().catch(() => {});
        }, 350);
      })
      .catch(() => {
        ScreenOrientation.unlockAsync().catch(() => {});
      });
  }, []);

  const enterFullscreen = useCallback(() => {
    // Request rotation; the visual layout waits for measured landscape geometry.
    enterLandscape();
  }, [enterLandscape]);

  const exitFullscreen = useCallback(() => {
    // The view and status bar return to portrait when the measured bounds do.
    restoreOrientation();
  }, [restoreOrientation]);

  const toggleFullscreen = useCallback(() => {
    if (isFullscreenView) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }, [isFullscreenView, enterFullscreen, exitFullscreen]);

  // Listen to physical device orientation changes
  useEffect(() => {
    const sub = ScreenOrientation.addOrientationChangeListener((evt) => {
      const orientation = evt.orientationInfo.orientation;
      const isLand =
        orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      if (isLand && !isFullscreen) {
        setIsFullscreen(true);
      } else if (!isLand && isFullscreen) {
        setIsFullscreen(false);
      }
    });
    return () => {
      ScreenOrientation.removeOrientationChangeListener(sub);
    };
  }, [isFullscreen]);

  // Handle hardware Android back button / back swipe
  useEffect(() => {
    const onBackPress = () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (allEpisodesOpen) {
        setAllEpisodesOpen(false);
        return true;
      }
      if (isFullscreenView) {
        // Exit fullscreen to portrait instead of navigating away!
        exitFullscreen();
        return true;
      }
      return false; // In portrait, let default router back handle it
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isFullscreenView, settingsOpen, allEpisodesOpen, exitFullscreen]);

  // Clean status bar handling for Android
  useEffect(() => {
    RNStatusBar.setHidden(isFullscreenView, 'none');
  }, [isFullscreenView]);

  // Restore screen orientation on unmount
  useEffect(() => {
    return () => {
      RNStatusBar.setHidden(false, 'none');
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
        .catch(() => {})
        .then(() => ScreenOrientation.unlockAsync().catch(() => {}));
    };
  }, []);

  // Show on-screen toast badge
  const showBadge = useCallback((text: string) => {
    setBadgeText(text);
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    badgeTimer.current = setTimeout(() => {
      setBadgeText(null);
    }, 1500);
  }, []);

  // Update video fit mode in CSS WITHOUT reloading HTML/WebView!
  const changeFitMode = useCallback(
    (newMode: FitMode) => {
      setFitMode(newMode);
      webViewRef.current?.injectJavaScript(`
        (function() {
          var v = document.getElementById('player');
          if (v) { v.className = '${newMode}'; }
        })();
        true;
      `);
      if (newMode === 'contain') showBadge('Fit to screen');
      else if (newMode === 'cover') showBadge('Zoomed to fill');
      else showBadge('Stretch to screen');
    },
    [showBadge],
  );

  const cycleFitMode = useCallback(() => {
    if (fitMode === 'contain') changeFitMode('cover');
    else if (fitMode === 'cover') changeFitMode('fill');
    else changeFitMode('contain');
  }, [fitMode, changeFitMode]);

  // Fetch anime detail
  const { data: anime } = useFetch(() => api.detail(String(id)), [id]);

  // Fetch episodes for current season
  const { data: epData, loading: episodesLoading } = useFetch(
    () => api.episodes(String(id), currentSeason),
    [id, currentSeason],
  );

  const episodes = useMemo(() => epData?.episodes || [], [epData]);
  const currentEpisodeObj = useMemo(
    () => episodes.find((e) => e.episode_number === currentEp) || null,
    [episodes, currentEp],
  );
  const nextEpisodeObj = useMemo(
    () => episodes.find((e) => e.episode_number === currentEp + 1) || null,
    [episodes, currentEp],
  );

  // Check whether the active episode has English Dub available
  const currentEpHasDub = useMemo(() => {
    if (currentEpisodeObj?.hasDub !== undefined) return Boolean(currentEpisodeObj.hasDub);
    if (typeof epData?.dubCount === 'number' && epData.dubCount > 0) return currentEp <= epData.dubCount;
    if (anime?.languages?.dub === 'full') return true;
    if (anime?.languages?.dub === 'partial') return currentEp <= 1;
    return false;
  }, [currentEpisodeObj?.hasDub, epData?.dubCount, currentEp, anime?.languages?.dub]);

  // Save progress to library once per episode
  useEffect(() => {
    if (!anime || currentEp <= 0) return;
    const key = `${anime.id}:${currentSeason}:${currentEp}`;
    if (recordedEpRef.current === key) return;
    recordedEpRef.current = key;

    const total = epData?.episodes?.length || anime.episodes || anime.episodeCount || null;
    setProgress(anime, currentEp, total);
  }, [anime, currentSeason, currentEp, epData?.episodes?.length, setProgress]);

  // Caching stream resolver: reuses cached resolution and prevents duplicate concurrent requests
  const resolveStreamWithCache = useCallback(
    async (
      title: string,
      romaji: string | undefined,
      season: number,
      episode: number,
      mode: 'sub' | 'dub',
      force = false,
    ) => {
      const key = `${title}:${season}:${episode}:${mode}`;
      if (!force) {
        const hit = streamCacheRef.current.get(key);
        if (hit && Date.now() < hit.expiresAt) {
          return hit.data;
        }
        if (hit) {
          streamCacheRef.current.delete(key);
        }
      }

      const running = inflightResolutionsRef.current.get(key);
      if (running) return running;

      const promise = (async () => {
        try {
          const res = await api.resolveStream(
            { title, romaji, season, episode, mode },
            { forceRefresh: force },
          );
          if (res && res.streamUrl) {
            streamCacheRef.current.set(key, { data: res, expiresAt: Date.now() + 30 * 60 * 1000 });
          }
          return res;
        } finally {
          inflightResolutionsRef.current.delete(key);
        }
      })();

      inflightResolutionsRef.current.set(key, promise);
      return promise;
    },
    [],
  );

  // Resolve stream URL for current episode/season
  useEffect(() => {
    if (!playerPreferencesLoaded || server !== 'hianime' || !anime?.title) return;
    // If the saved preference is Dub and anime-level metadata does not say
    // whether Dub exists, wait for episode metadata instead of resolving Sub
    // first and immediately issuing a second resolver request for Dub.
    const dubAvailabilityUnknown =
      currentLangRef.current === 'dub' &&
      anime.languages?.dub !== 'full' &&
      anime.languages?.dub !== 'partial' &&
      !epData;
    if (dubAvailabilityUnknown) return;

    let cancelled = false;
    currentEpisodeKeyRef.current = `${currentSeason}:${currentEp}`;

    // Target mode: prefer user preference if dub is available, otherwise default to sub
    const targetMode = currentLangRef.current === 'dub' && currentEpHasDub ? 'dub' : 'sub';
    if (targetMode !== currentLangRef.current) {
      setCurrentLang(targetMode);
      currentLangRef.current = targetMode;
    }

    setResolvingHls(true);
    setHlsError(null);

    resolveStreamWithCache(
      anime.title,
      anime.titleRomaji || undefined,
      currentSeason,
      currentEp,
      targetMode,
    )
      .then((res) => {
        if (cancelled || currentEpisodeKeyRef.current !== `${currentSeason}:${currentEp}`) return;
        if (res && res.streamUrl) {
          const resolvedEpisodeKey = `${currentSeason}:${currentEp}`;
          if (mountedStreamEpisodeKeyRef.current !== resolvedEpisodeKey) {
            const newEpisodeSourceKey = `${resolvedEpisodeKey}:${res.mode}:${res.streamUrl}`;
            setResumeAfterSourceChange({ key: newEpisodeSourceKey, time: 0, shouldPlay: true });
          }
          setHlsStream(res);
          mountedStreamEpisodeKeyRef.current = resolvedEpisodeKey;
          setMountedStream(res);
          setHlsError(null);
        } else {
          setHlsError('Stream unavailable on HiAnime');
        }
      })
      .catch((err) => {
        if (cancelled || currentEpisodeKeyRef.current !== `${currentSeason}:${currentEp}`) return;
        setHlsError(err?.message || 'Failed to resolve HiAnime stream');
      })
      .finally(() => {
        if (!cancelled && currentEpisodeKeyRef.current === `${currentSeason}:${currentEp}`) {
          setResolvingHls(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [playerPreferencesLoaded, server, anime?.title, anime?.titleRomaji, anime?.languages?.dub, epData, currentSeason, currentEp, currentEpHasDub, resolveStreamWithCache]);

  // Alternate Sub/Dub streams are resolved on demand instead of during cold
  // start. Eager prefetch ran before HLS reported in-band audio tracks, creating
  // an unnecessary second resolver request for many episodes. The resolver
  // cache and in-flight deduplication still apply when the user changes audio.

  // Show opening Content Advisory badge for 6 seconds on episode start
  useEffect(() => {
    setShowAdvisory(true);
    if (advisoryTimer.current) clearTimeout(advisoryTimer.current);
    advisoryTimer.current = setTimeout(() => {
      setShowAdvisory(false);
    }, 6000);
    return () => {
      if (advisoryTimer.current) clearTimeout(advisoryTimer.current);
    };
  }, [currentEp, currentSeason]);

  // Auto-hide controls overlay
  const resetHideTimer = useCallback(() => {
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    setControlsVisible(true);
    hideControlsTimer.current = setTimeout(() => {
      setIsPlaying((playing) => {
        if (playing) {
          setControlsVisible(false);
        }
        return playing;
      });
    }, 3800);
  }, []);

  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      setControlsVisible(false);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    } else {
      resetHideTimer();
    }
  }, [controlsVisible, resetHideTimer]);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [resetHideTimer]);

  // JavaScript injection is only used for the VidRift iframe fallback.
  const sendPlayerCommand = useCallback((code: string) => {
    if (server === 'vidrift') webViewRef.current?.injectJavaScript(`(function(){ ${code} })(); true;`);
  }, [server]);
  const seekNativePlayer = useCallback((time: number) => {
    const target = Math.max(0, time);
    nativeVideoRef.current?.seek?.(target);
    nativePlayerTimeRef.current = target;
    currentTimeRef.current = target;
  }, []);

  // Controls Actions
  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => { isPlayingRef.current = !prev; return !prev; });
    resetHideTimer();
  }, [resetHideTimer]);

  const handleRewind10 = useCallback(() => {
    const next = Math.max(0, nativePlayerTimeRef.current - 10);
    if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v)v.currentTime=${next};`); else seekNativePlayer(next);
    setCurrentTime(next); resetHideTimer();
  }, [server, sendPlayerCommand, seekNativePlayer, resetHideTimer]);

  const handleForward10 = useCallback(() => {
    const next = Math.min(duration || Number.MAX_SAFE_INTEGER, nativePlayerTimeRef.current + 10);
    if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v)v.currentTime=${next};`); else seekNativePlayer(next);
    setCurrentTime(next); resetHideTimer();
  }, [duration, server, sendPlayerCommand, seekNativePlayer, resetHideTimer]);

  const handleSeek = useCallback(
    (targetSec: number) => {
      const clamped = Math.max(0, Math.min(duration, targetSec));
      setCurrentTime(clamped);
      if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v)v.currentTime=${clamped};`); else seekNativePlayer(clamped);
      resetHideTimer();
    },
    [duration, server, sendPlayerCommand, seekNativePlayer, resetHideTimer],
  );

  const handleSetSpeed = useCallback((speed: number) => {
    setPlaybackSpeed(speed); playbackSpeedRef.current = speed;
    if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v)v.playbackRate=${speed};`);
  }, [server, sendPlayerCommand]);

  // The separate-stream in-place switch is retained only for VidRift. HiAnime
  // source changes are delegated to the native Video source prop.
  const applyStreamInPlace = useCallback((stream: StreamData, episodeKey: string, resumeTime = 0, shouldPlay = true, speed = playbackSpeedRef.current, quality = selectedQualityRef.current) => {
    if (server !== 'vidrift' || !stream?.streamUrl) return false;
    const subtitles = JSON.stringify((stream.subtitles || []).map((sub, idx) => ({label:sub.label || sub.lang || 'English',lang:sub.lang || 'en',src:toFullUrl(sub.src),default:sub.default || idx === 0})));
    sendPlayerCommand(`if(window.switchStream)window.switchStream(${JSON.stringify(toFullUrl(stream.streamUrl))},${subtitles},${resumeTime},${shouldPlay},${speed},${quality},${JSON.stringify(episodeKey)});`);
    return true;
  }, [server, sendPlayerCommand]);

  // Switch Audio Track
  // Path A: in-place Hls.js audioTrack switch when real alternate tracks exist in manifest
  // Path B: separate-stream fallback preserving position, state, speed, quality, subtitles
  const handleSelectAudio = useCallback(
    async (selection: { type: 'in-band'; trackId: number } | { type: 'separate'; mode: 'sub' | 'dub' }) => {
      if (selection.type === 'in-band') {
        // An in-band selection supersedes any outstanding separate-stream request.
        audioSwitchRequestRef.current += 1;
        setIsSwitchingAudio(false);
        setCurrentAudioTrackId(selection.trackId);
        setNativeAudioTrackId(selection.trackId);
        if (server === 'vidrift') sendPlayerCommand(`if(window._hls)window._hls.audioTrack=${selection.trackId};`);
        const track = availableAudioTracks.find((t) => t.id === selection.trackId);
        if (track) showBadge(`Audio: ${track.name || track.lang}`);
        return;
      }

      // Separate Sub/Dub stream fallback. A newer choice invalidates any older
      // resolver result so rapid taps cannot apply audio from an earlier choice.
      const requestId = ++audioSwitchRequestRef.current;
      const requestedEpisodeKey = `${currentSeason}:${currentEp}`;
      const targetMode = selection.mode;
      if (targetMode === currentLang) {
        setIsSwitchingAudio(false);
        return;
      }

      if (targetMode === 'dub' && !currentEpHasDub) {
        showBadge('English Dub not available for this episode');
        return;
      }

      setIsSwitchingAudio(true);
      showBadge(`Preparing ${targetMode === 'dub' ? 'English Dub' : 'Japanese (Sub)'}...`);

      try {
        const resolved = await resolveStreamWithCache(
          anime!.title,
          anime!.titleRomaji || undefined,
          currentSeason,
          currentEp,
          targetMode,
        );

        // Guard against episode changes and newer audio selections.
        if (requestId !== audioSwitchRequestRef.current || currentEpisodeKeyRef.current !== requestedEpisodeKey) return;

        if (!resolved || !resolved.streamUrl) {
          throw new Error(`Could not load ${targetMode.toUpperCase()} stream`);
        }

        const capturedTime = nativePlayerTimeRef.current || currentTimeRef.current;
        if (server === 'vidrift') {
          const dispatched = applyStreamInPlace(resolved, requestedEpisodeKey, capturedTime, isPlayingRef.current, playbackSpeedRef.current, selectedQualityRef.current);
          if (!dispatched) throw new Error('Player is still preparing. Please try again.');
        } else {
          const switchKey = `${requestedEpisodeKey}:${targetMode}:${resolved.streamUrl}`;
          setResumeAfterSourceChange({ key: switchKey, time: capturedTime, shouldPlay: isPlayingRef.current });
          mountedStreamEpisodeKeyRef.current = requestedEpisodeKey;
          setMountedStream(resolved);
        }

        setCurrentLang(targetMode);
        currentLangRef.current = targetMode;
        setHlsStream(resolved);
        try {
          AsyncStorage.setItem('animeverse_lang', targetMode).catch(() => {});
        } catch {}
        showBadge(`Audio: ${targetMode === 'dub' ? 'English (Dub)' : 'Japanese (Sub)'}`);
      } catch (err: any) {
        showBadge(err?.message || 'Failed to switch audio');
      } finally {
        if (requestId === audioSwitchRequestRef.current) setIsSwitchingAudio(false);
      }
    },
    [
      availableAudioTracks,
      currentLang,
      currentEpHasDub,
      anime,
      currentSeason,
      currentEp,
      resolveStreamWithCache,
      sendPlayerCommand,
      showBadge,
      applyStreamInPlace,
    ],
  );

  const handleSelectQuality = useCallback((targetHeight: number) => {
    setSelectedQualityHeight(targetHeight);
    selectedQualityRef.current = targetHeight;
    if (server === 'vidrift') sendPlayerCommand(`if(window._hls)window._hls.currentLevel=${targetHeight};`);
    // Native HLS uses resolution-based track selection; the native engine chooses
    // the closest available resolution when exact variants differ.
    showBadge(targetHeight === -1 ? 'Quality: Auto' : `Quality: ${targetHeight}p`);
  }, [server, sendPlayerCommand, showBadge]);

  const handleToggleSubtitles = useCallback(
    (enable: boolean) => {
      setSubtitlesEnabled(enable);
      subtitlesEnabledRef.current = enable;
      if (server === 'vidrift') sendPlayerCommand(`var v=document.querySelector('video');if(v&&v.textTracks)for(var i=0;i<v.textTracks.length;i++)v.textTracks[i].mode='${enable ? 'showing' : 'hidden'}';`);
      showBadge(enable ? 'Subtitles On' : 'Subtitles Off');
    },
    [server, sendPlayerCommand, showBadge],
  );

  const handleNextEpisode = useCallback(() => {
    if (episodes.length === 0) return;
    const maxEp = episodes[episodes.length - 1].episode_number;
    if (currentEp < maxEp) {
      const nextEp = currentEp + 1;
      currentEpisodeKeyRef.current = `${currentSeason}:${nextEp}`;
      audioSwitchRequestRef.current += 1;
      setIsSwitchingAudio(false);
      setResumeAfterSourceChange(null);
      nativePlayerTimeRef.current = 0;
      currentTimeRef.current = 0;
      isPlayingRef.current = false;
      setHlsError(null);
      setResolvingHls(true);
      setIsBuffering(true);
      setCurrentEp(nextEp);
      setCurrentTime(0);
      setBufferedTime(0);
      setIsPlaying(false);
      resetHideTimer();
    }
  }, [currentEp, currentSeason, episodes, resetHideTimer]);

  // Double-tap & Tap handler (YouTube / MX Player style)
  const handlePlayerAreaPress = useCallback(
    (e: GestureResponderEvent) => {
      const now = Date.now();
      const touchX = e.nativeEvent.locationX;
      const barW = progressBarWidthRef.current || width;

      if (now - lastTapRef.current.time < 300) {
        // Double Tap Action
        if (touchX < barW * 0.35) {
          handleRewind10();
          showBadge('-10s');
        } else if (touchX > barW * 0.65) {
          handleForward10();
          showBadge('+10s');
        } else {
          handleTogglePlay();
        }
        lastTapRef.current = { time: 0, x: 0 };
      } else {
        lastTapRef.current = { time: now, x: touchX };
        setTimeout(() => {
          if (lastTapRef.current.time === now) {
            toggleControls();
          }
        }, 280);
      }
    },
    [width, handleRewind10, handleForward10, handleTogglePlay, toggleControls, showBadge],
  );

  // Two-Finger Pinch-to-Zoom Gesture (Dynamic Fit / Fill like MX Player & YouTube)
  const handleTouchStart = useCallback((e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length === 2) {
      const [t1, t2] = e.nativeEvent.touches;
      initialPinchDistRef.current = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      if (e.nativeEvent.touches.length === 2 && initialPinchDistRef.current) {
        const [t1, t2] = e.nativeEvent.touches;
        const currentDist = Math.hypot(t1.pageX - t2.pageX, t1.pageY - t2.pageY);
        const diff = currentDist - initialPinchDistRef.current;
        if (diff > 45 && fitMode !== 'cover') {
          changeFitMode('cover');
          initialPinchDistRef.current = currentDist;
        } else if (diff < -45 && fitMode !== 'contain') {
          changeFitMode('contain');
          initialPinchDistRef.current = currentDist;
        }
      }
    },
    [fitMode, changeFitMode],
  );

  const handleTouchEnd = useCallback(() => {
    initialPinchDistRef.current = null;
  }, []);

  // Scrub bar touch & drag handler
  const handleScrubberPress = useCallback(
    (e: GestureResponderEvent) => {
      const touchX = e.nativeEvent.locationX;
      const barW = progressBarWidthRef.current || width;
      const ratio = Math.max(0, Math.min(1, touchX / barW));
      handleSeek(ratio * duration);
    },
    [width, duration, handleSeek],
  );

  // Build VidRift embed URL (fallback server)
  const vidriftEmbedUrl = useMemo(() => {
    const tmdbId = epData?.tmdbId;
    const params = new URLSearchParams({
      brand: 'AnimeVerse',
      brandColor: 'ff640a',
      brandLogo: 'https://api.iconify.design/ri/moon-clear-fill.svg?color=%23ff640a',
      watermark: '1',
      font: 'Inter',
      controlBg: 'solid',
      hide: 'episodes,next,server,cast',
      fs: 'parent',
    });

    return tmdbId
      ? `https://embed.vidrift.net/embed/tv/${tmdbId}/${currentSeason}/${currentEp}?${params.toString()}`
      : `https://embed.vidrift.net/embed/anilist/${id}/${currentEp}?${params.toString()}`;
  }, [epData?.tmdbId, currentSeason, currentEp, id]);

  // HiAnime streams go directly to ExoPlayer. The native source key uses the
  // episode key attached to the resolved stream, not the currently selected
  // episode, so a pending resolver result cannot relabel the previous source.
  const nativeStreamKey = mountedStream?.streamUrl
    ? `${mountedStreamEpisodeKeyRef.current || `${currentSeason}:${currentEp}`}:${mountedStream.mode}:${mountedStream.streamUrl}`
    : '';

  const nativeSubtitles = useMemo(() => (mountedStream?.subtitles || []).map((sub) => ({
    label: sub.label || sub.lang || 'English',
    lang: sub.lang || 'en',
    src: toFullUrl(sub.src),
    default: sub.default,
  })), [mountedStream?.subtitles]);

  useEffect(() => {
    if (server !== 'hianime' || !mountedStream?.streamUrl || !nativeStreamKey) return;
    if (nativeSourceKeyRef.current === nativeStreamKey) return;
    nativeSourceKeyRef.current = nativeStreamKey;
    setAvailableAudioTracks([]);
    setAvailableLevels([]);
    setNativeAudioTrackId(null);
    setNativeTextTrackId(null);
    setHasInBandAlternateAudio(false);
    setCurrentAudioTrackId(0);
    setIsBuffering(true);
    setHlsError(null);
  }, [server, mountedStream?.streamUrl, nativeStreamKey]);

  const onNativePlayerLoad = useCallback((loadedDuration: number) => {
    if (loadedDuration > 0) setDuration(loadedDuration);
    const pending = resumeAfterSourceChange;
    if (pending && pending.key === nativeSourceKeyRef.current) {
      if (pending.time > 0) {
        nativeVideoRef.current?.seek?.(pending.time);
        nativePlayerTimeRef.current = pending.time;
        currentTimeRef.current = pending.time;
        setCurrentTime(pending.time);
      }
      setIsPlaying(pending.shouldPlay);
      isPlayingRef.current = pending.shouldPlay;
      setResumeAfterSourceChange(null);
    }
    setIsBuffering(false);
    setResolvingHls(false);
  }, [resumeAfterSourceChange]);

  const onNativePlayerProgress = useCallback((time: number, loadedDuration: number, playable: number) => {
    nativePlayerTimeRef.current = time;
    currentTimeRef.current = time;
    setCurrentTime(time);
    if (loadedDuration > 0) setDuration(loadedDuration);
    setBufferedTime(playable);
  }, []);

  const onNativePlayerAudioTracks = useCallback((tracks: NativePlayerTrack[]) => {
    const audio = tracks.filter((track) => track.type === 'audio');
    setAvailableAudioTracks(audio.map(({ id, name, lang }) => ({ id, name, lang })));
    setHasInBandAlternateAudio(audio.length > 1);
    if (audio.length > 0 && nativeAudioTrackId === null) {
      const wanted = audio.find((track) => track.name.toLowerCase().includes(currentLangRef.current === 'dub' ? 'english' : 'japanese'));
      const initial = wanted || audio[0];
      setNativeAudioTrackId(initial.id);
      setCurrentAudioTrackId(initial.id);
    }
  }, [nativeAudioTrackId]);

  const onNativePlayerTextTracks = useCallback((tracks: NativePlayerTrack[]) => {
    const text = tracks.filter((track) => track.type === 'text');
    if (text.length > 0 && nativeTextTrackId === null) {
      const english = text.find((track) => track.name.toLowerCase().includes('english'));
      setNativeTextTrackId((english || text[0]).id);
    }
  }, [nativeTextTrackId]);

  const onNativePlayerVideoTracks = useCallback((tracks: NativeVideoLevel[]) => {
    setAvailableLevels(tracks.filter((track) => track.height > 0).map((track) => ({
      index: track.index,
      height: track.height,
      width: track.width,
      bitrate: track.bitrate,
    })));
  }, []);

  const onNativePlayerError = useCallback((message: string) => {
    setIsBuffering(false);
    setHlsError(message || 'Unable to play this stream');
    setResolvingHls(false);
  }, []);

  const handleVidRiftMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'play') {
        setIsPlaying(true);
        isPlayingRef.current = true;
      } else if (data.type === 'pause') {
        setIsPlaying(false);
        isPlayingRef.current = false;
      } else if (data.type === 'timeupdate') {
        if (typeof data.currentTime === 'number') {
          currentTimeRef.current = data.currentTime;
          nativePlayerTimeRef.current = data.currentTime;
          setCurrentTime(data.currentTime);
        }
        if (typeof data.duration === 'number' && data.duration > 0) setDuration(data.duration);
      } else if (data.type === 'buffered' && typeof data.buffered === 'number') {
        setBufferedTime(data.buffered);
      } else if (data.type === 'vidrift:ended' || data.type === 'vidrift:nextup-play' || data.type === 'ended') {
        if (autoplay) handleNextEpisode();
      }
    } catch {}
  }, [autoplay, handleNextEpisode]);

  // Interactive like / dislike toggles
  const handleToggleLike = useCallback(() => {
    if (liked) {
      setLiked(false);
      setLikeCount((c) => c - 1);
    } else {
      setLiked(true);
      setLikeCount((c) => c + 1);
      if (disliked) {
        setDisliked(false);
        setDislikeCount((c) => Math.max(0, c - 1));
      }
    }
  }, [liked, disliked]);

  const handleToggleDislike = useCallback(() => {
    if (disliked) {
      setDisliked(false);
      setDislikeCount((c) => Math.max(0, c - 1));
    } else {
      setDisliked(true);
      setDislikeCount((c) => c + 1);
      if (liked) {
        setLiked(false);
        setLikeCount((c) => Math.max(0, c - 1));
      }
    }
  }, [disliked, liked]);

  const progressRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const bufferedRatio = duration > 0 ? Math.min(1, Math.max(0, bufferedTime / duration)) : 0;

  // Active audio track name
  const currentAudioName = useMemo(() => {
    if (hasInBandAlternateAudio) {
      const track = availableAudioTracks.find((t) => t.id === currentAudioTrackId);
      return track?.name || track?.lang || 'Default Audio';
    }
    return currentLang === 'dub' ? 'English (Dub)' : 'Japanese (Sub)';
  }, [hasInBandAlternateAudio, availableAudioTracks, currentAudioTrackId, currentLang]);

  return (
    <View
      style={[styles.container, isFullscreenView ? styles.containerFullscreen : { paddingTop: insets.top }]}
      onLayout={onRootLayout}
    >
      <StatusBar hidden={isFullscreenView} style="light" />

      {/* Video Player Container (Integer math prevents Android YUV chroma green line decoder glitch) */}
      <View
        style={[
          styles.playerContainer,
          isFullscreenView
            ? styles.playerContainerLandscape
            : [styles.playerContainerPortrait, { height: Math.floor((activeWidth * 9) / 16) }],
        ]}
        onLayout={(e) => {
          progressBarWidthRef.current = e.nativeEvent.layout.width;
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {server === 'hianime' ? (
          mountedStream?.streamUrl ? (
            <NativeHlsPlayer
              ref={nativeVideoRef}
              uri={toFullUrl(mountedStream.streamUrl)}
              referer={mountedStream.referer}
              paused={!isPlaying}
              playbackRate={playbackSpeed}
              fitMode={fitMode}
              selectedQualityHeight={selectedQualityHeight}
              selectedAudioTrackId={nativeAudioTrackId}
              selectedTextTrackId={nativeTextTrackId}
              subtitlesEnabled={subtitlesEnabled}
              subtitles={nativeSubtitles}
              onLoad={onNativePlayerLoad}
              onProgress={onNativePlayerProgress}
              onBuffer={setIsBuffering}
              onAudioTracks={onNativePlayerAudioTracks}
              onTextTracks={onNativePlayerTextTracks}
              onVideoTracks={onNativePlayerVideoTracks}
              onEnd={() => { if (autoplay) handleNextEpisode(); }}
              onError={onNativePlayerError}
            />
          ) : null
        ) : (
          <MobileWebView
            ref={webViewRef}
            source={{ uri: vidriftEmbedUrl }}
            style={styles.webView}
            containerStyle={{ backgroundColor: '#000000' }}
            javaScriptEnabled
            domStorageEnabled
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows
            originWhitelist={['*']}
            onMessage={handleVidRiftMessage}
            startInLoadingState={false}
            renderToHardwareTextureAndroid
            overScrollMode="never"
            scrollEnabled={false}
            scalesPageToFit={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Loading Overlay (Non-destructive to WebView) */}
        {server === 'hianime' && resolvingHls && (
          <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.placeholderText}>Connecting to HiAnime Stream...</Text>
          </View>
        )}

        {/* Error Overlay (Non-destructive to WebView) */}
        {server === 'hianime' && !resolvingHls && hlsError && (
          <View style={[StyleSheet.absoluteFill, styles.playerPlaceholder]}>
            <Icon name="info" size={32} color={colors.accent} />
            <Text style={styles.placeholderError}>{hlsError}</Text>
            <PressableScale
              style={styles.switchServerBtn}
              onPress={() => {
                setServer('vidrift');
                AsyncStorage.setItem(SERVER_STORAGE_KEY, 'vidrift').catch(() => {});
              }}
            >
              <Text style={styles.switchServerText}>Play with VidRift</Text>
            </PressableScale>
          </View>
        )}

        {server === 'hianime' && isBuffering && isPlaying && !resolvingHls && !hlsError && (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        )}

        {/* Dynamic Zoom / Fit Toast Badge (flashes in center of player) */}
        {badgeText && (
          <View style={styles.badgeToast} pointerEvents="none">
            <Text style={styles.badgeToastText}>{badgeText}</Text>
          </View>
        )}

        {/* Crunchyroll Opening Content Advisory Badge (Top-left inside player for first 6 seconds) */}
        {showAdvisory && !controlsVisible && !settingsOpen && (
          <View style={styles.openingAdvisoryWrap} pointerEvents="none">
            <View style={styles.ageBadgeSmall}>
              <Text style={styles.ageBadgeSmallText}>{anime?.contentRating || 'U/A 16+'}</Text>
            </View>
            <Text style={styles.openingAdvisoryText} numberOfLines={2}>
              Sexualized Imagery, Smoking, Profanity, Suggestive Dialogue, Violence
            </Text>
          </View>
        )}

        {/* Touch Handler Surface (Single tap: toggle controls, Double tap: +/- 10s or play/pause) */}
        {!settingsOpen && <Pressable style={StyleSheet.absoluteFill} onPress={handlePlayerAreaPress} />}

        {/* 100% Integrated Crunchyroll Video Player UI */}
        {controlsVisible && !settingsOpen && (
          <View style={styles.controlsOverlay} pointerEvents="box-none">
            {/* Top Bar with subtle vignette gradient */}
            <LinearGradient
              colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.3)', 'transparent']}
              style={[
                styles.playerTopBar,
                isFullscreenView && {
                  paddingTop: Math.max(insets.top, 10),
                  paddingHorizontal: Math.max(insets.left, 16),
                },
              ]}
              pointerEvents="box-none"
            >
              {isFullscreenView ? (
                // Landscape Top-Left: Back Arrow to Exit Fullscreen + Series Title + Episode Title
                <View style={styles.landscapeTitleWrap}>
                  <PressableScale
                    onPress={exitFullscreen}
                    style={styles.landscapeBackBtn}
                    accessibilityLabel="Exit Fullscreen"
                  >
                    <Icon name="left" size={24} color="#fff" />
                  </PressableScale>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.landscapeSeriesTitle} numberOfLines={1}>
                      {anime?.title || 'AnimeVerse'}
                    </Text>
                    <Text style={styles.landscapeEpTitle} numberOfLines={1}>
                      E{currentEp} – {currentEpisodeObj?.name || `Episode ${currentEp}`}
                    </Text>
                  </View>
                </View>
              ) : (
                // Portrait Top-Left: Back Arrow
                <PressableScale
                  onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                  style={styles.iconCircleBtn}
                  accessibilityLabel="Back"
                >
                  <Icon name="left" size={24} color="#fff" />
                </PressableScale>
              )}

              {/* Top-Right Control Icons: [Fit/Zoom Mode] [Next] [Cast] [Settings] [Fullscreen/Exit] */}
              <View style={styles.playerTopRightIcons}>
                {/* Dynamic Aspect Ratio / Fit Toggle */}
                <PressableScale
                  onPress={cycleFitMode}
                  style={styles.iconCircleBtn}
                  accessibilityLabel="Toggle Screen Fit Mode"
                >
                  <Icon name="aspectRatio" size={22} color={fitMode !== 'contain' ? colors.accent : '#fff'} />
                </PressableScale>

                {nextEpisodeObj && (
                  <PressableScale
                    onPress={handleNextEpisode}
                    style={styles.iconCircleBtn}
                    accessibilityLabel="Next Episode"
                  >
                    <Icon name="skip" size={22} color="#fff" />
                  </PressableScale>
                )}
                <PressableScale
                  onPress={() =>
                    Alert.alert('Cast to Screen', 'Scanning local network for Google Cast & AirPlay devices...')
                  }
                  style={styles.iconCircleBtn}
                  accessibilityLabel="Cast"
                >
                  <Icon name="cast" size={22} color="#fff" />
                </PressableScale>
                <PressableScale
                  onPress={() => {
                    setSettingsSubView('main');
                    setSettingsOpen(true);
                  }}
                  style={styles.iconCircleBtn}
                  accessibilityLabel="Playback Settings"
                >
                  <Icon name="settings" size={22} color="#fff" />
                </PressableScale>
                <PressableScale
                  onPress={toggleFullscreen}
                  style={styles.iconCircleBtn}
                  accessibilityLabel={isFullscreenView ? 'Exit Fullscreen' : 'Fullscreen'}
                >
                  <Icon name={isFullscreenView ? 'exitFullscreen' : 'fullscreen'} size={22} color="#fff" />
                </PressableScale>
              </View>
            </LinearGradient>

            {/* Center Controls: [↺ 10]  [▶ / ⏸]  [↻ 10] (Crystal-clear background) */}
            <View style={styles.centerControlsRow} pointerEvents="box-none">
              <PressableScale
                onPress={handleRewind10}
                style={styles.centerIconBtn}
                accessibilityLabel="Rewind 10 seconds"
              >
                <Icon name="rewind10" size={isFullscreenView ? 44 : 38} color="#fff" />
              </PressableScale>

              <PressableScale
                onPress={handleTogglePlay}
                style={[styles.centerPlayBtn, isFullscreenView && styles.centerPlayBtnLandscape]}
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              >
                <Icon name={isPlaying ? 'pause' : 'play'} size={isFullscreenView ? 48 : 42} color="#fff" />
              </PressableScale>

              <PressableScale
                onPress={handleForward10}
                style={styles.centerIconBtn}
                accessibilityLabel="Forward 10 seconds"
              >
                <Icon name="forward10" size={isFullscreenView ? 44 : 38} color="#fff" />
              </PressableScale>
            </View>

            {/* Bottom Bar: Timecodes + Preload + Orange Scrubber Bar with subtle gradient */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.88)']}
              style={[
                styles.playerBottomBar,
                isFullscreenView && {
                  paddingHorizontal: Math.max(insets.left, 16),
                  paddingBottom: Math.max(insets.bottom, 10),
                },
              ]}
              pointerEvents="box-none"
            >
              <View style={styles.timecodeRow}>
                <Text style={styles.timecodeText}>{formatDuration(currentTime)}</Text>
                <Text style={styles.timecodeText}>{formatDuration(duration)}</Text>
              </View>

              {/* Scrubber Touch & Drag Area with Preload / Buffer Bar */}
              <View
                style={styles.scrubberTouchArea}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={handleScrubberPress}
                onResponderMove={handleScrubberPress}
              >
                <View style={styles.scrubberTrack}>
                  {/* Preloaded / Buffered Bar */}
                  <View style={[styles.scrubberBuffered, { width: `${bufferedRatio * 100}%` }]} />
                  {/* Played Progress Bar */}
                  <View style={[styles.scrubberProgress, { width: `${progressRatio * 100}%` }]} />
                </View>
                {/* Thumb Indicator */}
                <View
                  style={[
                    styles.scrubberThumb,
                    {
                      left: `${progressRatio * 100}%`,
                    },
                  ]}
                />
              </View>
            </LinearGradient>
          </View>
        )}

        {/* Crunchyroll In-Place Playback Settings Screen Overlay (Matches Screenshots 3 & 4) */}
        {settingsOpen && (
          <View
            style={[
              styles.settingsScreenOverlay,
              isFullscreenView
                ? {
                    paddingTop: Math.max(insets.top, 10),
                    paddingHorizontal: Math.max(insets.left, 24),
                    paddingBottom: Math.max(insets.bottom, 12),
                  }
                : { paddingTop: 12, paddingHorizontal: 18 },
            ]}
          >
            {/* Main Settings Menu */}
            {settingsSubView === 'main' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsOpen(false)} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Playback Settings</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                  {/* Autoplay Row */}
                  <View style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Autoplay</Text>
                    <Switch
                      value={autoplay}
                      onValueChange={(val) => {
                        setAutoplay(val);
                        AsyncStorage.setItem(AUTOPLAY_STORAGE_KEY, val ? '1' : '0').catch(() => {});
                      }}
                      trackColor={{ false: '#333', true: '#26a69a' }}
                      thumbColor="#fff"
                    />
                  </View>

                  {/* Audio Row (Dynamic multi-track audio!) */}
                  <PressableScale onPress={() => setSettingsSubView('audio')} style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Audio</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={styles.settingsValueText}>{currentAudioName}</Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Subtitles/CC Row */}
                  <PressableScale onPress={() => setSettingsSubView('subtitles')} style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Subtitles/CC</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={styles.settingsValueText}>{subtitlesEnabled ? 'English' : 'None'}</Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Quality Row (Dynamic 1080p, 720p, 480p, Auto) */}
                  <PressableScale onPress={() => setSettingsSubView('quality')} style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Quality</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={styles.settingsValueText}>
                        {selectedQualityHeight === -1 ? 'Auto' : `${selectedQualityHeight}p`}
                      </Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Screen Fit Mode */}
                  <PressableScale
                    onPress={() => {
                      cycleFitMode();
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={styles.settingsLabel}>Screen Scaling</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={[styles.settingsValueText, { color: colors.accent }]}>
                        {fitMode === 'contain' ? 'Fit to Screen' : fitMode === 'cover' ? 'Zoom to Fill' : 'Stretch'}
                      </Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Server Source */}
                  <PressableScale
                    onPress={() => {
                      const next = server === 'vidrift' ? 'hianime' : 'vidrift';
                      setServer(next);
                      AsyncStorage.setItem(SERVER_STORAGE_KEY, next).catch(() => {});
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={styles.settingsLabel}>Server Source</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={[styles.settingsValueText, { color: colors.accent }]}>
                        {server === 'vidrift' ? 'VidRift' : 'HiAnime (Native)'}
                      </Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Playback Speed Row */}
                  <PressableScale onPress={() => setSettingsSubView('speed')} style={styles.settingsRow}>
                    <Text style={styles.settingsLabel}>Playback Speed</Text>
                    <View style={styles.settingsValueWrap}>
                      <Text style={styles.settingsValueText}>{playbackSpeed.toFixed(1)}x</Text>
                      <Icon name="right" size={16} color={colors.muted} />
                    </View>
                  </PressableScale>

                  {/* Report a Problem */}
                  <PressableScale
                    onPress={() => {
                      Alert.alert('Report a Problem', 'Playback issue reported. Switch server to restore stream?', [
                        {
                          text: 'Switch to ' + (server === 'vidrift' ? 'HiAnime' : 'VidRift'),
                          onPress: () => {
                            const next = server === 'vidrift' ? 'hianime' : 'vidrift';
                            setServer(next);
                            AsyncStorage.setItem(SERVER_STORAGE_KEY, next).catch(() => {});
                          },
                        },
                        { text: 'Cancel', style: 'cancel' },
                      ]);
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={styles.settingsLabel}>Report a Problem</Text>
                    <Icon name="right" size={16} color={colors.muted} />
                  </PressableScale>
                </ScrollView>
              </>
            )}

            {/* Audio Sub-View */}
            {settingsSubView === 'audio' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsSubView('main')} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Audio Channels</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {hasInBandAlternateAudio ? (
                    // In-band alternate audio tracks
                    availableAudioTracks.map((track) => {
                      const isSel = currentAudioTrackId === track.id;
                      return (
                        <PressableScale
                          key={track.id}
                          onPress={() => {
                            handleSelectAudio({ type: 'in-band', trackId: track.id });
                            setSettingsSubView('main');
                          }}
                          style={styles.settingsRow}
                        >
                          <Text style={[styles.settingsLabel, isSel && { color: colors.accent }]}>
                            {track.name || track.lang}
                          </Text>
                          {isSel && <Icon name="check" size={20} color={colors.accent} />}
                        </PressableScale>
                      );
                    })
                  ) : (
                    // Separate Sub / Dub stream options
                    <>
                      {/* Japanese (Sub) */}
                      <PressableScale
                        onPress={() => {
                          if (currentLang !== 'sub') {
                            handleSelectAudio({ type: 'separate', mode: 'sub' });
                          }
                          setSettingsSubView('main');
                        }}
                        style={styles.settingsRow}
                        disabled={isSwitchingAudio}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.settingsLabel, currentLang === 'sub' && { color: colors.accent }]}>
                            Japanese (Sub)
                          </Text>
                          <Text style={styles.settingsSubLabel}>Original Japanese audio with English subtitles</Text>
                        </View>
                        {currentLang === 'sub' && <Icon name="check" size={20} color={colors.accent} />}
                      </PressableScale>

                      {/* English (Dub) */}
                      <PressableScale
                        onPress={() => {
                          if (!currentEpHasDub) return;
                          if (currentLang !== 'dub') {
                            handleSelectAudio({ type: 'separate', mode: 'dub' });
                          }
                          setSettingsSubView('main');
                        }}
                        style={[styles.settingsRow, !currentEpHasDub && { opacity: 0.45 }]}
                        disabled={!currentEpHasDub || isSwitchingAudio}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.settingsLabel, currentLang === 'dub' && { color: colors.accent }]}>
                            English (Dub)
                          </Text>
                          <Text style={styles.settingsSubLabel}>
                            {currentEpHasDub
                              ? 'English dubbed voice track'
                              : 'Japanese Audio (Sub) only for this episode'}
                          </Text>
                        </View>
                        {currentLang === 'dub' && <Icon name="check" size={20} color={colors.accent} />}
                        {!currentEpHasDub && (
                          <Text style={{ color: colors.muted, fontSize: 12 }}>Unavailable</Text>
                        )}
                      </PressableScale>
                    </>
                  )}
                </ScrollView>
              </>
            )}

            {/* Subtitles Sub-View */}
            {settingsSubView === 'subtitles' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsSubView('main')} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Subtitles/CC</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  <PressableScale
                    onPress={() => {
                      handleToggleSubtitles(true);
                      setSettingsSubView('main');
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={[styles.settingsLabel, subtitlesEnabled && { color: colors.accent }]}>English</Text>
                    {subtitlesEnabled && <Icon name="check" size={20} color={colors.accent} />}
                  </PressableScale>

                  <PressableScale
                    onPress={() => {
                      handleToggleSubtitles(false);
                      setSettingsSubView('main');
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={[styles.settingsLabel, !subtitlesEnabled && { color: colors.accent }]}>None</Text>
                    {!subtitlesEnabled && <Icon name="check" size={20} color={colors.accent} />}
                  </PressableScale>
                </ScrollView>
              </>
            )}

            {/* Quality Sub-View (Dynamically switches stream quality in Hls.js!) */}
            {settingsSubView === 'quality' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsSubView('main')} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Quality</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Auto Option */}
                  <PressableScale
                    onPress={() => {
                      handleSelectQuality(-1);
                      setSettingsSubView('main');
                    }}
                    style={styles.settingsRow}
                  >
                    <Text style={[styles.settingsLabel, selectedQualityHeight === -1 && { color: colors.accent }]}>
                      Auto (Adaptive)
                    </Text>
                    {selectedQualityHeight === -1 && <Icon name="check" size={20} color={colors.accent} />}
                  </PressableScale>

                  {/* Available stream resolutions */}
                  {(availableLevels.length > 0
                    ? availableLevels
                        .map((l) => l.height)
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .sort((a, b) => b - a)
                    : [1080, 720, 480, 360]
                  ).map((h) => {
                    const isSel = selectedQualityHeight === h;
                    return (
                      <PressableScale
                        key={h}
                        onPress={() => {
                          handleSelectQuality(h);
                          setSettingsSubView('main');
                        }}
                        style={styles.settingsRow}
                      >
                        <Text style={[styles.settingsLabel, isSel && { color: colors.accent }]}>{h}p</Text>
                        {isSel && <Icon name="check" size={20} color={colors.accent} />}
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </>
            )}

            {/* Speed Sub-View */}
            {settingsSubView === 'speed' && (
              <>
                <View style={styles.settingsHeader}>
                  <PressableScale onPress={() => setSettingsSubView('main')} style={styles.settingsBackBtn}>
                    <Icon name="left" size={22} color="#fff" />
                  </PressableScale>
                  <Text style={styles.settingsHeaderTitle}>Playback Speed</Text>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {[0.75, 1.0, 1.25, 1.5, 2.0].map((spd) => {
                    const isSel = playbackSpeed === spd;
                    return (
                      <PressableScale
                        key={spd}
                        onPress={() => {
                          handleSetSpeed(spd);
                          setSettingsSubView('main');
                        }}
                        style={styles.settingsRow}
                      >
                        <Text style={[styles.settingsLabel, isSel && { color: colors.accent }]}>
                          {spd === 1.0 ? '1.0x (Normal)' : `${spd.toFixed(2)}x`}
                        </Text>
                        {isSel && <Icon name="check" size={20} color={colors.accent} />}
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </>
            )}
          </View>
        )}
      </View>

      {/* Under-Player Content Area (Crunchyroll Layout in Portrait) */}
      {!isFullscreenView && (
        <ScrollView
          style={styles.detailsScroll}
          contentContainerStyle={[styles.detailsContent, { paddingBottom: insets.bottom + 30 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Series Name in orange */}
          <Text style={styles.seriesName}>{anime?.title || 'Anime'}</Text>

          {/* Episode Title (Big bold white text) */}
          <Text style={styles.episodeTitle}>
            E{currentEp} - {currentEpisodeObj?.name || `Episode ${currentEp}`}
          </Text>

          {/* Meta Badges (U/A 16+ • Dub | Sub) */}
          <View style={styles.metaRow}>
            <View style={styles.ageBadge}>
              <Text style={styles.ageBadgeText}>{anime?.contentRating || 'U/A 16+'}</Text>
            </View>
            <Text style={styles.metaDot}>•</Text>
            <Text style={styles.audioModesText}>
              {hasInBandAlternateAudio
                ? `${availableAudioTracks.length} Audios`
                : currentEpHasDub
                ? 'Dub | Sub'
                : 'Sub'}
            </Text>
          </View>

          {/* Interaction Bar (👍 2.9K, 👎 18, ↓ Download, ⋮ More) */}
          <View style={styles.interactionRow}>
            <View style={styles.interactionLeft}>
              <PressableScale onPress={handleToggleLike} style={styles.actionBtn}>
                <Icon name="thumbUp" size={20} color={liked ? colors.accent : '#fff'} />
                <Text style={[styles.actionBtnText, liked && { color: colors.accent }]}>
                  {likeCount > 1000 ? `${(likeCount / 1000).toFixed(1)}K` : likeCount}
                </Text>
              </PressableScale>

              <PressableScale onPress={handleToggleDislike} style={styles.actionBtn}>
                <Icon name="thumbDown" size={20} color={disliked ? colors.accent : '#fff'} />
                <Text style={[styles.actionBtnText, disliked && { color: colors.accent }]}>{dislikeCount}</Text>
              </PressableScale>
            </View>

            <View style={styles.interactionRight}>
              <PressableScale
                onPress={() => Alert.alert('Saved', `${anime?.title || 'Episode'} added to your offline library!`)}
                style={styles.actionIconOnlyBtn}
              >
                <Icon name="download" size={20} color="#fff" />
              </PressableScale>

              <PressableScale
                onPress={() => {
                  setSettingsSubView('main');
                  setSettingsOpen(true);
                }}
                style={styles.actionIconOnlyBtn}
              >
                <Icon name="more" size={20} color="#fff" />
              </PressableScale>
            </View>
          </View>

          {/* Episode Synopsis */}
          <Text style={styles.synopsisText}>
            {currentEpisodeObj?.overview ||
              anime?.synopsis ||
              'Mereoleona takes on the ancient demon and the Magic Knights rush to stop the Door to Hell from opening.'}
          </Text>

          {/* Content Advisory Section */}
          <View style={styles.advisorySection}>
            <Text style={styles.advisoryTitle}>Content Advisory</Text>
            <Text style={styles.advisoryRating}>{anime?.contentRating || 'U/A 16+'}</Text>
            <Text style={styles.advisoryDetails}>
              Sexualized Imagery, Smoking, Profanity, Suggestive Dialogue, Violence
            </Text>
          </View>

          {/* Next Episode Section */}
          {nextEpisodeObj && (
            <View style={styles.nextEpSection}>
              <Text style={styles.nextEpHeading}>Next Episode</Text>
              <PressableScale onPress={handleNextEpisode} style={styles.nextEpCard}>
                <View style={styles.nextEpThumbWrap}>
                  <Image
                    source={{
                      uri: nextEpisodeObj.still_path || anime?.backdrop || anime?.banner || anime?.image || undefined,
                    }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                  />
                  <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={StyleSheet.absoluteFill} />
                  <View style={styles.nextEpPlayIcon}>
                    <Icon name="play" size={14} color="#fff" />
                  </View>
                  <View style={styles.nextEpDurationBadge}>
                    <Text style={styles.nextEpDurationText}>{nextEpisodeObj.runtime || 23}m</Text>
                  </View>
                </View>

                <View style={styles.nextEpInfo}>
                  <Text style={styles.nextEpTitle} numberOfLines={2}>
                    {nextEpisodeObj.episode_number}. {nextEpisodeObj.name || `Episode ${nextEpisodeObj.episode_number}`}
                  </Text>
                </View>

                <View style={styles.nextEpDownloadWrap}>
                  <Icon name="download" size={18} color="#fff" />
                </View>
              </PressableScale>
            </View>
          )}

          {/* All Episodes Link */}
          <PressableScale onPress={() => setAllEpisodesOpen(true)} style={styles.allEpisodesLink}>
            <Text style={styles.allEpisodesText}>All Episodes</Text>
          </PressableScale>
        </ScrollView>
      )}

      {/* All Episodes Bottom Sheet */}
      <BottomSheet visible={allEpisodesOpen} onClose={() => setAllEpisodesOpen(false)} title="All Episodes">
        <ScrollView style={{ maxHeight: height * 0.65 }} showsVerticalScrollIndicator={false}>
          {epData?.seasons && epData.seasons.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasonsScroll}>
              {epData.seasons.map((s) => (
                <PressableScale
                  key={s.season_number}
                  onPress={() => {
                    const nextEpisodeKey = `${s.season_number}:1`;
                    currentEpisodeKeyRef.current = nextEpisodeKey;
                    audioSwitchRequestRef.current += 1;
                    setIsSwitchingAudio(false);
                    setResumeAfterSourceChange(null);
                    nativePlayerTimeRef.current = 0;
                    currentTimeRef.current = 0;
                    isPlayingRef.current = false;
                    setHlsError(null);
                    setResolvingHls(true);
                    setIsBuffering(true);
                    setCurrentSeason(s.season_number);
                    setCurrentEp(1);
                    setCurrentTime(0);
                    setBufferedTime(0);
                    setIsPlaying(false);
                  }}
                  style={[styles.seasonTab, currentSeason === s.season_number && styles.seasonTabActive]}
                >
                  <Text style={[styles.seasonTabText, currentSeason === s.season_number && styles.seasonTabTextActive]}>
                    {s.name || `Season ${s.season_number}`}
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>
          )}

          <View style={{ gap: 10, paddingVertical: 10 }}>
            {episodes.map((ep) => {
              const active = ep.episode_number === currentEp;
              const thumb = ep.still_path || anime?.backdrop || anime?.banner || anime?.image || undefined;
              return (
                <PressableScale
                  key={ep.episode_number}
                  onPress={() => {
                    const nextEpisodeKey = `${currentSeason}:${ep.episode_number}`;
                    currentEpisodeKeyRef.current = nextEpisodeKey;
                    audioSwitchRequestRef.current += 1;
                    setIsSwitchingAudio(false);
                    setResumeAfterSourceChange(null);
                    nativePlayerTimeRef.current = 0;
                    currentTimeRef.current = 0;
                    isPlayingRef.current = false;
                    setHlsError(null);
                    setResolvingHls(true);
                    setIsBuffering(true);
                    setCurrentEp(ep.episode_number);
                    setAllEpisodesOpen(false);
                    setCurrentTime(0);
                    setBufferedTime(0);
                    setIsPlaying(false);
                    resetHideTimer();
                  }}
                  style={[styles.sheetEpCard, active && styles.sheetEpCardActive]}
                >
                  <View style={styles.sheetEpThumbWrap}>
                    {thumb ? (
                      <Image
                        source={{ uri: thumb }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={200}
                        cachePolicy="memory-disk"
                      />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface2 }]} />
                    )}
                    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={StyleSheet.absoluteFill} />
                    {active && (
                      <View style={styles.sheetEpActiveIcon}>
                        <Icon name="play" size={14} color={colors.accent} />
                      </View>
                    )}
                    {ep.runtime ? (
                      <View style={styles.sheetEpDuration}>
                        <Text style={styles.sheetEpDurationText}>{ep.runtime}m</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.sheetEpMeta}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={[styles.sheetEpNum, active && { color: colors.accent }]}>
                        EPISODE {ep.episode_number}
                      </Text>
                      <EpisodeBadges hasSub={ep.hasSub} hasDub={ep.hasDub} />
                    </View>
                    <Text style={[styles.sheetEpTitle, active && { color: colors.accent }]} numberOfLines={1}>
                      {ep.name || `Episode ${ep.episode_number}`}
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  containerFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 9999,
  },
  playerContainer: {
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
  },
  playerContainerPortrait: {
    width: '100%',
  },
  playerContainerLandscape: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    zIndex: 9999,
    backgroundColor: '#000',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000000',
  },
  playerPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#0a0a0c',
  },
  placeholderText: {
    marginTop: 12,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  placeholderError: {
    marginTop: 12,
    color: colors.danger,
    fontFamily: fonts.bold,
    fontSize: 14,
    textAlign: 'center',
  },
  switchServerBtn: {
    marginTop: 14,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  switchServerText: {
    color: '#000',
    fontFamily: fonts.bold,
    fontSize: 13,
  },

  // On-Screen Toast Badge (e.g. "+10s", "-10s", "Fit to screen", "Zoomed to fill")
  badgeToast: {
    position: 'absolute',
    alignSelf: 'center',
    top: '46%',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    zIndex: 40,
  },
  badgeToastText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 13,
    letterSpacing: 0.5,
  },

  // Crunchyroll Opening Content Advisory Badge
  openingAdvisoryWrap: {
    position: 'absolute',
    top: 14,
    left: 14,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 10,
  },
  ageBadgeSmall: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  ageBadgeSmallText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 9.5,
  },
  openingAdvisoryText: {
    color: '#fff',
    fontFamily: fonts.regular,
    fontSize: 11,
    opacity: 0.9,
    flexShrink: 1,
  },

  // Integrated Controls Overlay (No flat dark veil; transparent center + edge gradients)
  controlsOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
    justifyContent: 'space-between',
    zIndex: 20,
  },

  // Top Bar inside Player with gradient
  playerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 24,
  },
  landscapeTitleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingRight: 16,
  },
  landscapeBackBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeSeriesTitle: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 15,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  landscapeEpTitle: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: fonts.regular,
    fontSize: 12.5,
    marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  playerTopRightIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconCircleBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Center Controls
  centerControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
  },
  centerIconBtn: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.7,
    shadowRadius: 4,
    elevation: 4,
  },
  centerPlayBtn: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 5,
    elevation: 5,
  },
  centerPlayBtnLandscape: {
    width: 72,
    height: 72,
  },

  // Bottom Scrubber Bar with gradient
  playerBottomBar: {
    paddingHorizontal: 14,
    paddingTop: 24,
    paddingBottom: 6,
  },
  timecodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  timecodeText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 11,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  scrubberTouchArea: {
    height: 24,
    justifyContent: 'center',
    position: 'relative',
  },
  scrubberTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  scrubberBuffered: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.45)', // Preloaded buffer bar!
  },
  scrubberProgress: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  scrubberThumb: {
    position: 'absolute',
    top: 5,
    marginLeft: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },

  // Playback Settings Screen Overlay (Crunchyroll Style in Portrait & Landscape)
  settingsScreenOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    zIndex: 50,
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    marginBottom: 8,
  },
  settingsBackBtn: {
    padding: 6,
  },
  settingsHeaderTitle: {
    color: '#fff',
    fontFamily: fonts.black,
    fontSize: 18,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  settingsLabel: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  settingsSubLabel: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    marginTop: 2,
  },
  settingsValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsValueText: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 14,
  },

  // Under-Player Details Section
  detailsScroll: {
    flex: 1,
    backgroundColor: '#000',
  },
  detailsContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  seriesName: {
    color: colors.accent,
    fontFamily: fonts.bold,
    fontSize: 13,
    marginBottom: 4,
  },
  episodeTitle: {
    color: '#fff',
    fontFamily: fonts.black,
    fontSize: 20,
    lineHeight: 26,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  ageBadge: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  ageBadgeText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 10.5,
  },
  metaDot: {
    color: colors.muted,
    fontSize: 12,
  },
  audioModesText: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  interactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    marginBottom: 14,
  },
  interactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  interactionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  actionBtnText: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  actionIconOnlyBtn: {
    padding: 6,
  },
  synopsisText: {
    color: '#d0d0d0',
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 20,
  },
  advisorySection: {
    marginBottom: 24,
  },
  advisoryTitle: {
    color: '#fff',
    fontFamily: fonts.black,
    fontSize: 15,
  },
  advisoryRating: {
    color: colors.text2,
    fontFamily: fonts.bold,
    fontSize: 12,
    marginBottom: 2,
  },
  advisoryDetails: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
  },
  nextEpSection: {
    marginBottom: 24,
  },
  nextEpHeading: {
    color: '#fff',
    fontFamily: fonts.black,
    fontSize: 15,
  },
  nextEpCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1014',
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingRight: 14,
  },
  nextEpThumbWrap: {
    width: 140,
    height: 82,
    backgroundColor: colors.surface2,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextEpPlayIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextEpDurationBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  nextEpDurationText: {
    color: '#fff',
    fontFamily: fonts.regular,
    fontSize: 10,
  },
  nextEpInfo: {
    flex: 1,
    paddingHorizontal: 12,
  },
  nextEpTitle: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  nextEpDownloadWrap: {
    padding: 6,
  },
  allEpisodesLink: {
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 10,
  },
  allEpisodesText: {
    color: colors.accent,
    fontFamily: fonts.black,
    fontSize: 15,
  },

  // Seasons & Episodes Bottom Sheet
  seasonsScroll: {
    gap: 8,
    paddingVertical: 6,
  },
  seasonTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
  },
  seasonTabActive: {
    backgroundColor: colors.accent,
  },
  seasonTabText: {
    color: colors.muted,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  seasonTabTextActive: {
    color: '#000',
  },
  sheetEpCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.surface2,
    height: 78,
  },
  sheetEpCardActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(255,100,10,0.08)',
  },
  sheetEpThumbWrap: {
    width: 120,
    height: '100%',
    backgroundColor: colors.surface2,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetEpActiveIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetEpDuration: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  sheetEpDurationText: {
    color: '#fff',
    fontFamily: fonts.regular,
    fontSize: 9.5,
  },
  sheetEpMeta: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  sheetEpNum: {
    color: colors.muted,
    fontFamily: fonts.black,
    fontSize: 10.5,
  },
  sheetEpTitle: {
    color: '#fff',
    fontFamily: fonts.bold,
    fontSize: 12.5,
    marginTop: 2,
  },
});
