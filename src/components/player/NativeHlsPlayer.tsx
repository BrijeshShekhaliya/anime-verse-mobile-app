import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
} from 'react';
import { StyleSheet } from 'react-native';
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

export type NativeVideoLevel = {
  index: number;
  height: number;
  width: number;
  bitrate: number;
};

export type NativeVideoPlayerHandle = {
  seek: (time: number) => void;
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
  // Kept in the adapter contract for the watch screen. expo-video v58 exposes
  // in-band HLS subtitle tracks, but does not expose a sidecar WebVTT injection API.
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
  minBufferForPlayback: 2.5,
  preferredForwardBufferDuration: 50,
  prioritizeTimeOverSizeThreshold: true,
};

function toAudioTracks(player: ReturnType<typeof useVideoPlayer>): NativePlayerTrack[] {
  return player.availableAudioTracks.map((track, index) => ({
    id: index,
    name: track.name || track.label || track.language || `Audio ${index + 1}`,
    lang: track.language || '',
    type: 'audio',
  }));
}

function toTextTracks(player: ReturnType<typeof useVideoPlayer>): NativePlayerTrack[] {
  return player.availableSubtitleTracks.map((track, index) => ({
    id: index,
    name: track.name || track.label || track.language || `Subtitle ${index + 1}`,
    lang: track.language || '',
    type: 'text',
  }));
}

function toVideoLevels(player: ReturnType<typeof useVideoPlayer>): NativeVideoLevel[] {
  return player.availableVideoTracks.map((track, index) => {
    // Track metadata differs slightly between platform implementations. Read it
    // defensively so a missing bitrate/size never breaks playback.
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

const NativeHlsPlayer = forwardRef<NativeVideoPlayerHandle, Props>(function NativeHlsPlayer({
  uri,
  referer,
  paused,
  playbackRate,
  fitMode,
  selectedQualityHeight,
  selectedAudioTrackId = null,
  selectedTextTrackId = null,
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
  const player = useVideoPlayer(null, (instance) => {
    instance.timeUpdateEventInterval = 0.4;
    instance.bufferOptions = BUFFER_OPTIONS;
    instance.keepScreenOnWhilePlaying = true;
    instance.staysActiveInBackground = false;
  });

  useImperativeHandle(forwardedRef, () => ({
    seek: (time: number) => {
      player.currentTime = Math.max(0, time);
    },
  }), [player]);

  const source: VideoSource | null = uri
    ? {
        uri,
        contentType: 'hls',
        ...(referer ? { headers: { Referer: referer, referer } } : {}),
        useCaching: false,
      }
    : null;

  // Keep one VideoPlayer instance alive across source, orientation and control
  // changes. Replacing its source avoids remounting the native rendering surface.
  useEffect(() => {
    if (!source) return;
    let active = true;
    onBuffer(true);
    onError('');
    player.replaceAsync(source).then(() => {
      if (!active) return;
      if (paused) player.pause();
      else player.play();
    }).catch((error: unknown) => {
      if (!active) return;
      onBuffer(false);
      onError(error instanceof Error ? error.message : 'Unable to load the HLS stream');
    });
    return () => {
      active = false;
    };
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

  useEffect(() => {
    if (selectedQualityHeight < 0) {
      player.maxResolution = null;
      return;
    }
    // expo-video exposes an adaptive resolution cap rather than selecting a
    // platform-specific track index.
    player.maxResolution = {
      width: Math.round((selectedQualityHeight * 16) / 9),
      height: selectedQualityHeight,
    };
  }, [player, selectedQualityHeight]);

  const publishTracks = useCallback(() => {
    onAudioTracks(toAudioTracks(player));
    onTextTracks(toTextTracks(player));
    onVideoTracks(toVideoLevels(player));
  }, [player, onAudioTracks, onTextTracks, onVideoTracks]);

  useEffect(() => {
    const subscriptions = [
      player.addListener('sourceLoad', (event) => {
        onLoad(event.duration || player.duration || 0);
        publishTracks();
        onBuffer(false);
      }),
      player.addListener('timeUpdate', (event) => {
        onProgress(
          Math.max(0, event.currentTime || 0),
          Math.max(0, player.duration || 0),
          Math.max(0, event.bufferedPosition || 0),
        );
      }),
      player.addListener('statusChange', (event) => {
        if (event.status === 'loading') onBuffer(true);
        if (event.status === 'readyToPlay') onBuffer(false);
        if (event.status === 'error') {
          onBuffer(false);
          const error = event.error as unknown as { message?: string } | undefined;
          onError(error?.message || 'Native HLS playback failed');
        }
      }),
      player.addListener('availableAudioTracksChange', publishTracks),
      player.addListener('availableSubtitleTracksChange', publishTracks),
      player.addListener('availableVideoTracksChange', publishTracks),
      player.addListener('playToEnd', onEnd),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [player, onLoad, onProgress, onBuffer, onError, onEnd, publishTracks]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      nativeControls={false}
      contentFit={fitMode}
      allowsPictureInPicture={false}
    />
  );
});

export default memo(NativeHlsPlayer);
