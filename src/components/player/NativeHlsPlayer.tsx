import React, { forwardRef, memo, useCallback, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Video, {
  type OnAudioTracksData,
  type OnBufferData,
  type OnLoadData,
  type OnProgressData,
  type OnTextTracksData,
  type SelectedTrack,
  type SelectedVideoTrack,
  type TextTrackType,
  type VideoRef,
} from 'react-native-video';

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
  onEnd: () => void;
  onError: (message: string) => void;
};

const HLS_BUFFER_CONFIG = {
  minBufferMs: 15000,
  maxBufferMs: 50000,
  bufferForPlaybackMs: 2500,
  bufferForPlaybackAfterRebufferMs: 5000,
  backBufferDurationMs: 30000,
  maxHeapAllocationPercent: 0.5,
  minBackBufferMemoryReservePercent: 0.1,
  minBufferMemoryReservePercent: 0.1,
};

const NativeHlsPlayer = forwardRef<VideoRef, Props>(function NativeHlsPlayer({
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
  onEnd,
  onError,
}, forwardedRef) {
  const source = useMemo(() => ({
    uri,
    type: 'm3u8' as const,
    ...(referer ? { headers: { Referer: referer, referer } } : {}),
    minLoadRetryCount: 3,
    bufferConfig: HLS_BUFFER_CONFIG,
    textTracks: subtitles.map((subtitle) => ({
      title: subtitle.label,
      language: subtitle.lang || 'en',
      type: 'text/vtt' as TextTrackType,
      uri: subtitle.src,
    })),
  }), [uri, referer, subtitles]);

  const selectedVideoTrack: SelectedVideoTrack = useMemo(
    () => selectedQualityHeight < 0
      ? { type: 'auto' }
      : { type: 'resolution', value: selectedQualityHeight },
    [selectedQualityHeight],
  );
  const selectedAudioTrack: SelectedTrack = useMemo(
    () => selectedAudioTrackId === null ? { type: 'system' } : { type: 'index', value: selectedAudioTrackId },
    [selectedAudioTrackId],
  );
  const selectedTextTrack: SelectedTrack = useMemo(
    () => !subtitlesEnabled
      ? { type: 'disabled' }
      : selectedTextTrackId === null
        ? { type: 'system' }
        : { type: 'index', value: selectedTextTrackId },
    [subtitlesEnabled, selectedTextTrackId],
  );

  const handleLoad = useCallback((event: OnLoadData) => {
    onLoad(event.duration || 0);
  }, [onLoad]);

  const handleProgress = useCallback((event: OnProgressData) => {
    onProgress(
      Math.max(0, event.currentTime || 0),
      Math.max(0, event.seekableDuration || 0),
      Math.max(0, event.playableDuration || 0),
    );
  }, [onProgress]);

  const handleBuffer = useCallback((event: OnBufferData) => {
    onBuffer(Boolean(event.isBuffering));
  }, [onBuffer]);

  const handleAudioTracks = useCallback((event: OnAudioTracksData) => {
    onAudioTracks((event.audioTracks || []).map((track) => ({
      id: track.index,
      name: track.title || track.language || `Audio ${track.index + 1}`,
      lang: track.language || '',
      type: 'audio' as const,
    })));
  }, [onAudioTracks]);

  const handleTextTracks = useCallback((event: OnTextTracksData) => {
    onTextTracks((event.textTracks || []).map((track) => ({
      id: track.index,
      name: track.title || track.language || `Subtitle ${track.index + 1}`,
      lang: track.language || '',
      type: 'text' as const,
    })));
  }, [onTextTracks]);

  return (
    <Video
      ref={forwardedRef}
      source={source}
      style={StyleSheet.absoluteFill}
      paused={paused}
      resizeMode={fitMode}
      rate={playbackRate}
      progressUpdateInterval={400}
      bufferConfig={HLS_BUFFER_CONFIG}
      minLoadRetryCount={3}
      maxBitRate={0}
      selectedVideoTrack={selectedVideoTrack}
      selectedAudioTrack={selectedAudioTrack}
      selectedTextTrack={selectedTextTrack}
      onLoad={handleLoad}
      onProgress={handleProgress}
      onBuffer={handleBuffer}
      onAudioTracks={handleAudioTracks}
      onTextTracks={handleTextTracks}
      onEnd={onEnd}
      onError={(event) => onError(event.error?.errorString || event.error?.errorException || 'Native stream playback failed')}
      automaticallyWaitsToMinimizeStalling
      ignoreSilentSwitch="ignore"
      playInBackground={false}
      playWhenInactive={false}
      preventsDisplaySleepDuringVideoPlayback
      repeat={false}
      controls={false}
    />
  );
});

export default memo(NativeHlsPlayer);
