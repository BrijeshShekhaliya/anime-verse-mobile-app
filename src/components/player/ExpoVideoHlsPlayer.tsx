import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer, type VideoSource } from 'expo-video';

export type NativePlayerTrack = {
  id: number;
  name: string;
  lang: string;
  type: 'audio' | 'text';
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
  fitMode: 'contain' | 'cover' | 'fill';
  selectedQualityHeight: number;
  selectedAudioTrackId?: number | null;
  selectedTextTrackId?: number | null;
  subtitles: NativeSubtitle[];
  subtitlesEnabled: boolean;
  onLoad: (duration: number) => void;
  onProgress: (time: number, duration: number, buffered: number) => void;
  onBuffer: (buffering: boolean) => void;
  onAudioTracks: (tracks: NativePlayerTrack[]) => void;
  onTextTracks: (tracks: NativePlayerTrack[]) => void;
  onVideoTracks: (levels: NativeVideoLevel[]) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

const BUFFER_OPTIONS = {
  // Start after a short startup buffer, then keep a larger forward window so
  // brief mobile-network dips do not immediately stall playback. The byte
  // budget must be large enough for a minute of high-bitrate 1080p HLS.
  minBufferForPlayback: 3.5,
  preferredForwardBufferDuration: 60,
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
  return player.availableAudioTracks.map((track, index) => ({
    id: index,
    name: track.name || track.label || track.language || `Audio ${index + 1}`,
    lang: track.language || '',
    type: 'audio' as const,
  }));
}

function toTextTracks(player: ReturnType<typeof useVideoPlayer>): NativePlayerTrack[] {
  return player.availableSubtitleTracks.map((track, index) => ({
    id: index,
    name: track.name || track.label || track.language || `Subtitle ${index + 1}`,
    lang: track.language || '',
    type: 'text' as const,
  }));
}

function toVideoLevels(player: ReturnType<typeof useVideoPlayer>): NativeVideoLevel[] {
  return player.availableVideoTracks.map((track, index) => {
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
}

const ExpoVideoHlsPlayer = forwardRef<NativeVideoPlayerHandle, Props>(function ExpoVideoHlsPlayer({
  uri,
  referer,
  paused,
  playbackRate,
  fitMode,
  selectedQualityHeight,
  selectedAudioTrackId = null,
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
    useCaching: false,
  } : null;

  // Keep one VideoPlayer instance alive across source, orientation and control changes.
  useEffect(() => {
    if (!source) return;
    let active = true;
    readySourceRef.current = null;
    onBuffer(true);
    setHasEmbeddedSubtitleTracks(false);
    setExternalSubtitleCues([]);
    player.replaceAsync(source).then(() => {
      if (!active) return;
      if (paused) player.pause();
      else player.play();
    }).catch((error: unknown) => {
      if (!active) return;
      onBuffer(false);
      onError(error instanceof Error ? error.message : 'Unable to load the HLS stream');
    });
    return () => { active = false; };
  }, [player, uri, referer, onBuffer, onError]);

  useEffect(() => {
    if (paused) player.pause();
    else if (uri) player.play();
  }, [player, paused, uri]);

  useEffect(() => {
    player.playbackRate = playbackRate;
  }, [player, playbackRate]);

  useEffect(() => {
    if (selectedAudioTrackId === null || selectedAudioTrackId < 0) return;
    const track = player.availableAudioTracks[selectedAudioTrackId];
    if (track) player.audioTrack = track;
  }, [player, selectedAudioTrackId]);

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
        // Source metadata and track lists can arrive before the first frame is
        // actually ready. Publish tracks now, but restore the playhead only when
        // ExoPlayer reports readyToPlay.
        publishTracks();
      }),
      player.addListener('timeUpdate', (event) => {
        const time = Math.max(0, event.currentTime || 0);
        setPlaybackTime(time);
        onProgress(time, Math.max(0, player.duration || 0), Math.max(0, event.bufferedPosition || 0));
      }),
      player.addListener('statusChange', (event) => {
        if (event.status === 'loading') onBuffer(true);
        if (event.status === 'readyToPlay') {
          onBuffer(false);
          if (readySourceRef.current !== uri) {
            readySourceRef.current = uri;
            onLoad(Math.max(0, player.duration || 0));
            publishTracks();
          }
        }
        if (event.status === 'error') {
          onBuffer(false);
          const error = event.error as unknown as { message?: string } | undefined;
          onError(error?.message || 'HLS playback failed');
        }
      }),
      player.addListener('availableAudioTracksChange', publishTracks),
      player.addListener('availableSubtitleTracksChange', publishTracks),
      player.addListener('playToEnd', onEnd),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [player, uri, onLoad, onProgress, onBuffer, onError, onEnd, publishTracks]);

  const activeSubtitle = externalSubtitleCues.find((cue) => playbackTime >= cue.start && playbackTime <= cue.end);

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit={fitMode}
        // TextureView resizes with the rotated React Native layout. SurfaceView can
        // briefly retain portrait-sized video or flash black during fullscreen changes.
        surfaceType="textureView"
        allowsPictureInPicture={false}
      />
      {subtitlesEnabled && !hasEmbeddedSubtitleTracks && activeSubtitle ? (
        <View pointerEvents="none" style={styles.subtitleContainer}>
          <Text style={styles.subtitleText}>{activeSubtitle.text}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
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
