import React, { forwardRef, memo, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { NativeMedia3View, type NativeMedia3ViewRef, type Media3Track, type Media3Level } from 'native-media3-player';
import ExpoVideoHlsPlayer, { type NativePlayerTrack, type NativeSubtitle, type NativeVideoLevel, type NativeVideoPlayerHandle } from './ExpoVideoHlsPlayer';

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

type Cue = { start: number; end: number; text: string };

function parseCues(raw: string): Cue[] {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const blocks = normalized.split(/\n\s*\n/);
  const cues: Cue[] = [];
  const seconds = (v: string) => {
    const m = v.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{1,3})/);
    return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] + '00').slice(0, 3)) / 1000 : NaN;
  };
  for (const block of blocks) {
    const lines = block.split('\n').map((x) => x.trim()).filter(Boolean);
    const at = lines.findIndex((x) => x.includes('-->'));
    if (at < 0) continue;
    const [a, b] = lines[at].split('-->');
    const start = seconds(a), end = seconds(b);
    const text = lines.slice(at + 1).join(' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    if (Number.isFinite(start) && end > start && text) cues.push({ start, end, text });
  }
  return cues;
}

const NativeHlsPlayer = forwardRef<NativeVideoPlayerHandle, Props>(function NativeHlsPlayer(props, forwardedRef) {
  if (Platform.OS !== 'android') {
    return <ExpoVideoHlsPlayer {...props} ref={forwardedRef} />;
  }
  return <AndroidMedia3Player {...props} ref={forwardedRef} />;
});

const AndroidMedia3Player = forwardRef<NativeVideoPlayerHandle, Props>(function AndroidMedia3Player({
  uri, referer, paused, playbackRate, fitMode, selectedQualityHeight, selectedAudioTrackId = null,
  selectedTextTrackId = null, subtitles, subtitlesEnabled, onLoad, onProgress, onBuffer,
  onAudioTracks, onTextTracks, onVideoTracks, onEnd, onError,
}, forwardedRef) {
  const nativeRef = useRef<NativeMedia3ViewRef | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [hasEmbeddedSubtitleTracks, setHasEmbeddedSubtitleTracks] = useState(false);
  const [cues, setCues] = useState<Cue[]>([]);

  useImperativeHandle(forwardedRef, () => ({ seek: (time: number) => nativeRef.current?.seek(time) }), []);

  React.useEffect(() => {
    if (!subtitlesEnabled || hasEmbeddedSubtitleTracks || subtitles.length === 0) {
      setCues([]);
      return;
    }
    const selected = subtitles.find((item) => item.default)
      || subtitles.find((item) => /english|en/i.test(item.label + ' ' + item.lang))
      || subtitles[0];
    let active = true;
    setCues([]);
    fetch(selected.src, { headers: referer ? { Referer: referer, referer } : undefined })
      .then((response) => { if (!response.ok) throw new Error('Subtitle request failed'); return response.text(); })
      .then((raw) => { if (active) setCues(parseCues(raw)); })
      .catch(() => { if (active) setCues([]); });
    return () => { active = false; };
  }, [subtitles, subtitlesEnabled, hasEmbeddedSubtitleTracks, referer]);

  const audioTracks = useCallback((event: { nativeEvent: { tracks: Media3Track[] } }) => {
    onAudioTracks(event.nativeEvent.tracks as NativePlayerTrack[]);
  }, [onAudioTracks]);
  const textTracks = useCallback((event: { nativeEvent: { tracks: Media3Track[] } }) => {
    const tracks = event.nativeEvent.tracks as NativePlayerTrack[];
    setHasEmbeddedSubtitleTracks(tracks.length > 0);
    onTextTracks(tracks);
  }, [onTextTracks]);
  const videoTracks = useCallback((event: { nativeEvent: { levels: Media3Level[] } }) => {
    onVideoTracks(event.nativeEvent.levels as NativeVideoLevel[]);
  }, [onVideoTracks]);
  const activeCue = cues.find((cue) => playbackTime >= cue.start && playbackTime <= cue.end);

  return (
    <View style={StyleSheet.absoluteFill}>
      <NativeMedia3View
        ref={nativeRef as React.Ref<NativeMedia3ViewRef>}
        style={StyleSheet.absoluteFill}
        uri={uri}
        referer={referer}
        paused={paused}
        playbackRate={playbackRate}
        fitMode={fitMode}
        selectedQualityHeight={selectedQualityHeight}
        selectedAudioTrackId={selectedAudioTrackId}
        selectedTextTrackId={selectedTextTrackId}
        subtitlesEnabled={subtitlesEnabled}
        onLoad={(event) => onLoad(event.nativeEvent.duration)}
        onProgress={(event) => {
          const { time, duration, buffered } = event.nativeEvent;
          setPlaybackTime(time);
          onProgress(time, duration, buffered);
        }}
        onBuffer={(event) => onBuffer(event.nativeEvent.buffering)}
        onAudioTracks={audioTracks}
        onTextTracks={textTracks}
        onVideoTracks={videoTracks}
        onEnd={onEnd}
        onError={(event) => onError(event.nativeEvent.message)}
      />
      {subtitlesEnabled && !hasEmbeddedSubtitleTracks && activeCue ? (
        <View pointerEvents="none" style={styles.subtitleContainer}>
          <Text style={styles.subtitleText}>{activeCue.text}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  subtitleContainer: { position: 'absolute', left: 18, right: 18, bottom: 54, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  subtitleText: { color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.72)', fontSize: 17, lineHeight: 24, textAlign: 'center', paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
});

export default memo(NativeHlsPlayer);

// Preserve the watch screen's existing shared player type imports.
export type { NativePlayerTrack, NativeVideoLevel } from './ExpoVideoHlsPlayer';
