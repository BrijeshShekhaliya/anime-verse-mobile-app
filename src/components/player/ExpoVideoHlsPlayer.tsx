import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';

export type NativePlayerTrack = {
  id: number;
  name: string;
  lang: string;
  type: 'audio' | 'text';
  selected?: boolean;
};

export type NativeSubtitle = {
  label: string;
  lang: string;
  src: string;
  default?: boolean;
};

export type NativeVideoLevel = { index: number; height: number; width: number; bitrate: number };
export type NativeVideoPlayerHandle = { seek: (time: number) => void };
type SubtitleCue = { start: number; end: number; text: string };

type Props = {
  uri: string;
  referer?: string;
  paused: boolean;
  playbackRate: number;
  volume?: number; // 0..1, the player's own volume
  fitMode: 'contain' | 'cover' | 'fill';
  selectedQualityHeight: number;
  selectedAudioTrackId?: number | null;
  preferredAudioLanguage?: string | null;
  fallbackAudioLanguage?: string | null;
  startTime?: number; // where a new video starts, in seconds
  enhanced?: boolean; // View Enhancement (Expo Go can only change colour; the APK's is the real one)
  zoomStyle?: React.ComponentProps<typeof Animated.View>['style']; // the pinched size, on the video alone: subtitles stay put
  onSystemPause?: () => void; // the system stopped it: a call, another app's sound
  selectedTextTrackId?: number | null;
  subtitles: NativeSubtitle[];
  subtitlesEnabled: boolean;
  onLoad: (duration: number) => void;
  onProgress: (time: number, duration: number, buffered: number, videoWidth?: number, videoHeight?: number) => void;
  onBuffer: (buffering: boolean) => void;
  onAudioTracks: (tracks: NativePlayerTrack[]) => void;
  onTextTracks: (tracks: NativePlayerTrack[]) => void;
  onVideoTracks: (levels: NativeVideoLevel[]) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

import { isAudioLanguageMatch, hasAudioLanguage } from '@/lib/audioMatch';
export { isAudioLanguageMatch, hasAudioLanguage };

const BUFFER_OPTIONS = {
  // Start as soon as a moment of video is ready, then keep a larger forward
  // window so brief mobile-network dips do not immediately stall playback. The
  // byte budget must be large enough for a minute of high-bitrate 1080p HLS.
  minBufferForPlayback: 0.8,
  preferredForwardBufferDuration: 30,
  maxBufferBytes: 128 * 1024 * 1024,
  prioritizeTimeOverSizeThreshold: true,
};

function parseSubtitleCues(raw: string): SubtitleCue[] {
  return raw.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) return [];
    const timing = lines[timingIndex].split('-->');
    const toSeconds = (value: string) => {
      const match = value.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{1,3})/);
      if (!match) return NaN;
      return Number(match[1] || 0) * 3600
        + Number(match[2]) * 60
        + Number(match[3])
        + Number((match[4] + '00').slice(0, 3)) / 1000;
    };
    const start = toSeconds(timing[0]);
    const end = toSeconds(timing[1]);
    const text = lines.slice(timingIndex + 1).join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .trim();
    return Number.isFinite(start) && Number.isFinite(end) && end > start && text
      ? [{ start, end, text }]
      : [];
  });
}

function toAudioTracks(player: ReturnType<typeof useVideoPlayer>): NativePlayerTrack[] {
  try {
    const tracks = player.availableAudioTracks;
    if (!tracks || !Array.isArray(tracks)) return [];
    const currentTrack = player.audioTrack;
    return tracks.map((track, index) => ({
      id: index,
      name: track.name || track.label || track.language || `Audio ${index + 1}`,
      lang: track.language || '',
      type: 'audio' as const,
      selected: currentTrack === track || (!!currentTrack?.language && track.language === currentTrack?.language),
    }));
  } catch {
    return [];
  }
}

function toTextTracks(player: ReturnType<typeof useVideoPlayer>): NativePlayerTrack[] {
  try {
    const tracks = player.availableSubtitleTracks;
    if (!tracks || !Array.isArray(tracks)) return [];
    return tracks.map((track, index) => ({
      id: index,
      name: track.name || track.label || track.language || `Subtitle ${index + 1}`,
      lang: track.language || '',
      type: 'text' as const,
    }));
  } catch {
    return [];
  }
}

function toVideoLevels(player: ReturnType<typeof useVideoPlayer>): NativeVideoLevel[] {
  try {
    const tracks = player.availableVideoTracks;
    if (!tracks || !Array.isArray(tracks)) return [];
    return tracks.map((track, index) => {
      const value = track as unknown as {
        size?: { width?: number; height?: number };
        width?: number;
        height?: number;
        bitrate?: number;
      };
      return {
        index,
        width: value.size?.width || value.width || 0,
        height: value.size?.height || value.height || 0,
        bitrate: value.bitrate || 0,
      };
    });
  } catch {
    return [];
  }
}

const ExpoVideoHlsPlayer = forwardRef<NativeVideoPlayerHandle, Props>(function ExpoVideoHlsPlayer({
  uri,
  referer,
  paused,
  playbackRate,
  volume = 1,
  fitMode,
  selectedQualityHeight,
  selectedAudioTrackId = null,
  preferredAudioLanguage = null,
  fallbackAudioLanguage = null,
  startTime = 0,
  enhanced = false,
  zoomStyle,
  onSystemPause,
  selectedTextTrackId = null,
  subtitles,
  subtitlesEnabled,
  onLoad,
  onProgress,
  onBuffer,
  onAudioTracks,
  onTextTracks,
  onVideoTracks,
  onEnd,
  onError,
}, forwardedRef) {
  const [playbackTime, setPlaybackTime] = useState(0);
  const [hasEmbeddedSubtitleTracks, setHasEmbeddedSubtitleTracks] = useState(false);
  const [externalSubtitleCues, setExternalSubtitleCues] = useState<SubtitleCue[]>([]);
  const readySourceRef = useRef<string | null>(null);

  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 0.4;
    instance.bufferOptions = BUFFER_OPTIONS;
    // Within half a second of the target: a nearby keyframe if there is one (shown at
    // once), otherwise the player decodes up to it.
    instance.seekTolerance = { toleranceBefore: 0.5, toleranceAfter: 0.5 };
    instance.keepScreenOnWhilePlaying = true;
    instance.staysActiveInBackground = false;
  });

  useImperativeHandle(forwardedRef, () => ({
    seek: (time: number) => { player.currentTime = Math.max(0, time); },
  }), [player]);

  const source: VideoSource | null = uri ? {
    uri,
    contentType: 'hls',
    ...(referer ? { headers: { Referer: referer, referer } } : {}),
    useCaching: true,
  } : null;

  // The screen makes new callbacks whenever its data refreshes. Loading reads the
  // latest ones from here, so only a new address ever (re)loads the video: having
  // them as dependencies restarted the stream at random and downloaded it twice.
  const latest = useRef({ onBuffer, onError, onSystemPause, paused, source, startTime });
  latest.current = { onBuffer, onError, onSystemPause, paused, source, startTime };

  // A lost signal mid-episode isn't a broken video: pick up from the same moment
  // (twice at most, then the screen's own recovery takes over).
  const playedToRef = useRef(0);
  const retries = useRef({ count: 0, at: 0 });
  const retryAfterNetworkError = useCallback(() => {
    const { source: current } = latest.current;
    if (!current || retries.current.count >= 2 || playedToRef.current <= 0) return false;
    retries.current = { count: retries.current.count + 1, at: playedToRef.current };
    const resumeAt = playedToRef.current;
    latest.current.onBuffer(true);
    setTimeout(() => {
      player.replaceAsync(current).then(() => {
        player.currentTime = resumeAt;
        if (!latest.current.paused) player.play();
      }).catch(() => latest.current.onError('HLS playback failed'));
    }, 1000 * retries.current.count);
    return true;
  }, [player]);

  // A new video waits here until its tracks are known and its language is set. Started
  // straight away, it played the default language for a moment, then reloaded the audio
  // when the right one was chosen: half a second of the wrong language, then the loader.
  const waitingForTracksRef = useRef(false);
  const startOnceTracksAreSet = useCallback(() => {
    if (!waitingForTracksRef.current) return;
    waitingForTracksRef.current = false;
    if (!latest.current.paused) player.play();
  }, [player]);

  // Keep one VideoPlayer instance alive across source, orientation and control changes.
  useEffect(() => {
    if (!source) return;
    let active = true;
    waitingForTracksRef.current = true;
    readySourceRef.current = null;
    playedToRef.current = 0;
    retries.current = { count: 0, at: 0 };
    latest.current.onBuffer(true);
    setHasEmbeddedSubtitleTracks(false);
    setExternalSubtitleCues([]);
    player.replaceAsync(source).then(() => {
      if (!active) return;
      if (latest.current.startTime > 0) {
        player.currentTime = latest.current.startTime;
        playedToRef.current = latest.current.startTime;
      }
      if (latest.current.paused || waitingForTracksRef.current) player.pause();
      else player.play();
    }).catch((error: unknown) => {
      if (!active) return;
      latest.current.onBuffer(false);
      latest.current.onError(error instanceof Error ? error.message : 'Unable to load the HLS stream');
    });
    return () => { active = false; };
  }, [player, uri, referer]);

  useEffect(() => {
    if (paused) player.pause();
    else if (uri && !waitingForTracksRef.current) player.play();
  }, [player, paused, uri]);

  // Android pauses this player by itself when the app leaves the screen, and nothing else
  // restarts it: the screen still thinks it's playing, so it never asks again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && uri && !latest.current.paused && !waitingForTracksRef.current) {
        try {
          player.play();
        } catch {
          // Already released: this screen is closing.
        }
      }
    });
    return () => sub.remove();
  }, [player, uri]);

  // The player stopped without being asked (a call, another app's sound): the button has to
  // say so. Waits a moment, because buffering also stops it, and only then does the status
  // show which of the two this is.
  const systemPauseCheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (systemPauseCheck.current) clearTimeout(systemPauseCheck.current);
  }, []);
  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying }) => {
      if (systemPauseCheck.current) clearTimeout(systemPauseCheck.current);
      if (isPlaying) return;
      systemPauseCheck.current = setTimeout(() => {
        if (AppState.currentState !== 'active' || latest.current.paused || waitingForTracksRef.current) return;
        try {
          if (!player.playing && player.status === 'readyToPlay') latest.current.onSystemPause?.();
        } catch {
          // Already released: this screen is closing.
        }
      }, 400);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    player.playbackRate = playbackRate;
  }, [player, playbackRate]);

  useEffect(() => {
    player.volume = Math.min(1, Math.max(0, volume));
  }, [player, volume]);

  const syncAudioTrack = useCallback(() => {
    const available = player.availableAudioTracks;
    if (!available || available.length === 0) return;
    // Choosing the track already playing would reload its audio for nothing. (Each read
    // of a track gives a new object, so comparing the objects never finds a match.)
    const choose = (target: (typeof available)[number]) => {
      const now = player.audioTrack;
      if (!now || now.id !== target.id) player.audioTrack = target;
    };

    if (selectedAudioTrackId !== null && selectedAudioTrackId >= 0 && available[selectedAudioTrackId]) {
      choose(available[selectedAudioTrackId]);
      return;
    }

    if (preferredAudioLanguage) {
      const by = (language: string) => available.find((t) => isAudioLanguageMatch(t.name || t.label || '', t.language || '', language));
      const match = by(preferredAudioLanguage) || (fallbackAudioLanguage ? by(fallbackAudioLanguage) : undefined) || by('japanese') || by('english');
      if (match) choose(match);
    }
  }, [player, selectedAudioTrackId, preferredAudioLanguage, fallbackAudioLanguage]);

  useEffect(() => {
    syncAudioTrack();
  }, [syncAudioTrack]);

  useEffect(() => {
    if (!subtitlesEnabled) {
      player.subtitleTrack = null;
      return;
    }
    if (selectedTextTrackId !== null && selectedTextTrackId >= 0) {
      const track = player.availableSubtitleTracks[selectedTextTrackId];
      if (track) player.subtitleTrack = track;
    }
  }, [player, selectedTextTrackId, subtitlesEnabled]);

  const applyVideoQuality = useCallback(() => {
    if (selectedQualityHeight < 0) {
      // Expo Video exposes adaptive quality through maxResolution. videoTrack is
      // read-only; setting it does not force a rendition and can fail at runtime.
      player.maxResolution = null;
      return;
    }

    const available = player.availableVideoTracks;
    const readHeight = (track: (typeof available)[number]) => {
      const value = track as unknown as {
        size?: { width?: number; height?: number };
        width?: number;
        height?: number;
      };
      return value.size?.height || value.height || 0;
    };
    const exact = available.find((track) => readHeight(track) === selectedQualityHeight);
    const requestedHeight = exact ? readHeight(exact) : selectedQualityHeight;
    // Expo Video's supported manual-quality API is maxResolution (the current
    // videoTrack is read-only). On Android this is a hard ceiling, so ExoPlayer
    // cannot silently choose a resolution above the user's selection.
    player.maxResolution = {
      width: exact
        ? ((exact as unknown as { size?: { width?: number } }).size?.width || Math.round((requestedHeight * 16) / 9))
        : Math.round((requestedHeight * 16) / 9),
      height: requestedHeight,
    };
  }, [player, selectedQualityHeight]);

  useEffect(() => {
    applyVideoQuality();
  }, [applyVideoQuality]);

  const publishTracks = useCallback(() => {
    onAudioTracks(toAudioTracks(player));
    const textTracks = toTextTracks(player);
    setHasEmbeddedSubtitleTracks(textTracks.length > 0);
    onTextTracks(textTracks);
    onVideoTracks(toVideoLevels(player));
    applyVideoQuality();
  }, [player, onAudioTracks, onTextTracks, onVideoTracks, applyVideoQuality]);

  // Expo Video supports in-band HLS subtitles. Resolver-provided sidecar VTT/SRT
  // files use a lightweight JS cue overlay when the stream has no embedded tracks.
  useEffect(() => {
    if (!subtitlesEnabled || hasEmbeddedSubtitleTracks || subtitles.length === 0) {
      setExternalSubtitleCues([]);
      return;
    }
    const selected = subtitles.find((item) => item.default)
      || subtitles.find((item) => /english|en/i.test(item.label + ' ' + item.lang))
      || subtitles[0];
    let active = true;
    setExternalSubtitleCues([]);
    fetch(selected.src, { headers: referer ? { Referer: referer, referer } : undefined })
      .then((response) => {
        if (!response.ok) throw new Error('Subtitle request failed');
        return response.text();
      })
      .then((raw) => { if (active) setExternalSubtitleCues(parseSubtitleCues(raw)); })
      .catch(() => { if (active) setExternalSubtitleCues([]); });
    return () => { active = false; };
  }, [subtitles, subtitlesEnabled, hasEmbeddedSubtitleTracks, referer]);

  useEffect(() => {
    const subscriptions = [
      player.addListener('sourceLoad', () => {
        syncAudioTrack();
        // Source metadata and track lists can arrive before the first frame is
        // actually ready. Publish tracks now, but restore the playhead only when
        // ExoPlayer reports readyToPlay.
        publishTracks();
        startOnceTracksAreSet();
      }),
      player.addListener('timeUpdate', (event) => {
        const time = Math.max(0, event.currentTime || 0);
        playedToRef.current = time;
        if (retries.current.count > 0 && time > retries.current.at + 10) retries.current = { count: 0, at: 0 };
        if (hasCuesRef.current) setPlaybackTime(time); // only subtitles on screen need it here
        const playing = player.videoTrack as unknown as { size?: { width?: number; height?: number } } | null;
        onProgress(time, Math.max(0, player.duration || 0), Math.max(0, event.bufferedPosition || 0), playing?.size?.width, playing?.size?.height);
      }),
      player.addListener('statusChange', (event) => {
        if (event.status === 'loading') onBuffer(true);
        if (event.status === 'readyToPlay') {
          // In case the tracks never announced themselves: never stay stuck waiting.
          syncAudioTrack();
          startOnceTracksAreSet();
          onBuffer(false);
          if (readySourceRef.current !== uri) {
            readySourceRef.current = uri;
            onLoad(Math.max(0, player.duration || 0));
            publishTracks();
          }
        }
        if (event.status === 'error') {
          if (retryAfterNetworkError()) return;
          onBuffer(false);
          const error = event.error as unknown as { message?: string } | undefined;
          onError(error?.message || 'HLS playback failed');
        }
      }),
      player.addListener('availableAudioTracksChange', () => {
        syncAudioTrack();
        publishTracks();
      }),
      player.addListener('availableSubtitleTracksChange', publishTracks),
      player.addListener('playToEnd', onEnd),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [player, uri, onLoad, onProgress, onBuffer, onError, onEnd, publishTracks, syncAudioTrack, retryAfterNetworkError, startOnceTracksAreSet]);

  const hasCuesRef = useRef(false);
  hasCuesRef.current = externalSubtitleCues.length > 0;
  const activeSubtitle = externalSubtitleCues.find((cue) => playbackTime >= cue.start && playbackTime <= cue.end);

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* The view's size differs by a pixel per mode (hidden by the frame): the video view only
          applies a new fit when its layout changes, so otherwise it could stay as it was.
          collapsable: without it this view only exists while filtered, so each toggle moved the
          video to a new parent, which replaced its surface: a flicker and lost frames. */}
      <Animated.View collapsable={false} style={[StyleSheet.absoluteFill, zoomStyle]}>
      <View collapsable={false} style={[StyleSheet.absoluteFill, enhanced && styles.enhanced]}>
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, { right: fitMode === 'contain' ? 0 : fitMode === 'cover' ? -1 : -2 }]}
        nativeControls={false}
        contentFit={fitMode}
        // TextureView resizes with the rotated React Native layout. SurfaceView can
        // briefly retain portrait-sized video or flash black during fullscreen changes.
        surfaceType="textureView"
        allowsPictureInPicture={false}
      />
      </View>
      </Animated.View>
      {subtitlesEnabled && !hasEmbeddedSubtitleTracks && activeSubtitle ? (
        <View pointerEvents="none" style={styles.subtitleContainer}>
          <Text style={styles.subtitleText}>{activeSubtitle.text}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  // One fixed filter for every scene, so it must be safe for all of them. No contrast: it
  // pushes everything below mid-grey down, which is what darkened night scenes.
  enhanced: { filter: [{ brightness: 1.026 }, { saturate: 1.26 }] },
  subtitleContainer: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 54,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  subtitleText: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
});

export default memo(ExpoVideoHlsPlayer);
