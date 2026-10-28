import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Modal, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Video, { type VideoRef, type OnLoadData, type OnProgressData, type OnBufferData, type SelectedTrack } from 'react-native-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { colors } from '@/lib/theme';

export type NativePlayerTrack = { id: number; name: string; lang: string; type: 'audio' | 'text' };
type Props = {
  uri: string;
  referer?: string;
  episodeKey: string;
  mode: 'sub' | 'dub';
  paused: boolean;
  playbackRate: number;
  fitMode: 'contain' | 'cover' | 'fill';
  selectedQualityHeight: number;
  subtitles: { label: string; lang: string; src: string; default?: boolean }[];
  subtitlesEnabled: boolean;
  onPausedChange: (paused: boolean) => void;
  onProgress: (time: number, duration: number, buffered: number) => void;
  onLoad: (duration: number, tracks: NativePlayerTrack[], selectedTrackId: number | null) => void;
  onBuffer: (buffering: boolean) => void;
  onEnd: () => void;
  onError: (message: string) => void;
  onFullscreenChange?: (fullscreen: boolean) => void;
};

const positionOf = (height: number) => ({ height, aspectRatio: 16 / 9 });

function PlayerSurface({
  uri, referer, episodeKey, mode, paused, playbackRate, fitMode, selectedQualityHeight,
  subtitles, subtitlesEnabled, onPausedChange, onProgress, onLoad, onBuffer, onEnd, onError, onFullscreenChange
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const videoRef = useRef<VideoRef>(null);
  const modalVideoRef = useRef<VideoRef>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [tracks, setTracks] = useState<NativePlayerTrack[]>([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number | null>(null);
  const [selectedTextTrack, setSelectedTextTrack] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const lastErrorKey = useRef('');
  const sourceGeneration = useRef(0);
  const seekOnLoad = useRef(0);
  const latestTime = useRef(0);
  const latestPaused = useRef(paused);
  const fullscreenRef = useRef(false);
  fullscreenRef.current = fullscreen;
  latestPaused.current = paused;

  const source = useMemo(() => ({
    uri,
    ...(referer ? { headers: { Referer: referer, referer } } : {}),
    type: uri.toLowerCase().includes('.m3u8') ? 'm3u8' as const : undefined,
  }), [uri, referer]);

  const selectedVideoTrack: SelectedTrack = useMemo(() => selectedQualityHeight < 0
    ? { type: 'auto' }
    : { type: 'resolution', value: selectedQualityHeight }, [selectedQualityHeight]);

  const finishFullscreen = useCallback(async () => {
    setFullscreen(false);
    fullscreenRef.current = false;
    onFullscreenChange?.(false);
    try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); } catch {}
    StatusBar.setHidden(false, 'fade');
  }, [onFullscreenChange]);

  const enterFullscreen = useCallback(async () => {
    seekOnLoad.current = latestTime.current;
    setFullscreen(true);
    fullscreenRef.current = true;
    onFullscreenChange?.(true);
    try { await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE); } catch {}
    StatusBar.setHidden(true, 'fade');
  }, [onFullscreenChange]);

  const toggleFullscreen = useCallback(() => {
    if (fullscreenRef.current) void finishFullscreen();
    else void enterFullscreen();
  }, [enterFullscreen, finishFullscreen]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!fullscreenRef.current) return false;
      void finishFullscreen();
      return true;
    });
    return () => sub.remove();
  }, [finishFullscreen]);

  useEffect(() => {
    const generation = ++sourceGeneration.current;
    setLocalError(null);
    setBuffering(true);
    setTime(0);
    setBuffered(0);
    latestTime.current = 0;
    setDuration(0);
    setTracks([]);
    setSelectedAudioTrack(null);
    setSelectedTextTrack(null);
    // A new URI is a real media transition. This is the only event that should
    // replace the native source; fullscreen transitions never change source.
    return () => { if (sourceGeneration.current === generation) sourceGeneration.current++; };
  }, [uri, episodeKey, mode]);

  useEffect(() => {
    if (fullscreen && duration > 0) {
      const timer = setTimeout(() => {
        if (seekOnLoad.current > 0) {
          modalVideoRef.current?.seek(seekOnLoad.current);
          seekOnLoad.current = 0;
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [fullscreen, duration]);

  const handleLoad = useCallback((data: OnLoadData) => {
    setDuration(data.duration || 0);
    onLoad(data.duration || 0, tracks, selectedAudioTrack);
    setBuffering(false);
    if (seekOnLoad.current > 0) {
      (fullscreenRef.current ? modalVideoRef.current : videoRef.current)?.seek(seekOnLoad.current);
      seekOnLoad.current = 0;
    }
  }, [onLoad, tracks, selectedAudioTrack]);

  const handleProgress = useCallback((data: OnProgressData) => {
    const ct = Math.max(0, data.currentTime || 0);
    latestTime.current = ct;
    setTime(ct);
    setBuffered(Math.max(0, data.playableDuration || 0));
    setDuration((old) => data.seekableDuration > 0 ? data.seekableDuration : old);
    onProgress(ct, data.seekableDuration || duration, data.playableDuration || 0);
  }, [onProgress, duration]);

  const handleBuffer = useCallback((data: OnBufferData) => {
    setBuffering(Boolean(data.isBuffering));
    onBuffer(Boolean(data.isBuffering));
  }, [onBuffer]);

  const handleError = useCallback((data: { error?: { errorString?: string; errorException?: string } }) => {
    const message = data.error?.errorString || data.error?.errorException || 'Native video playback failed';
    setLocalError(message);
    setBuffering(false);
    if (lastErrorKey.current !== `${episodeKey}:${uri}:${message}`) {
      lastErrorKey.current = `${episodeKey}:${uri}:${message}`;
      onError(message);
    }
  }, [episodeKey, uri, onError]);

  const handleAudioTracks = useCallback((data: { audioTracks: { index: number; title?: string; language?: string }[] }) => {
    const mapped = (data.audioTracks || []).map((t) => ({
      id: t.index,
      name: t.title || t.language || `Audio ${t.index + 1}`,
      lang: t.language || '',
      type: 'audio' as const,
    }));
    setTracks((prev) => [...prev.filter((t) => t.type !== 'audio'), ...mapped]);
    onLoad(duration, mapped, selectedAudioTrack);
  }, [duration, onLoad, selectedAudioTrack]);

  const handleTextTracks = useCallback((data: { textTracks: { index: number; title?: string; language?: string }[] }) => {
    const mapped = (data.textTracks || []).map((t) => ({
      id: t.index,
      name: t.title || t.language || `Subtitle ${t.index + 1}`,
      lang: t.language || '',
      type: 'text' as const,
    }));
    setTracks((prev) => [...prev.filter((t) => t.type !== 'text'), ...mapped]);
  }, []);

  const selectAudio = useCallback((trackId: number) => {
    setSelectedAudioTrack(trackId);
  }, []);

  const selectText = useCallback((trackId: number | null) => {
    setSelectedTextTrack(trackId);
  }, []);

  const formatTime = (value: number) => {
    const t = Math.floor(Math.max(0, value));
    const h = Math.floor(t / 3600);
    return h ? `${h}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  const video = (ref: React.RefObject<VideoRef | null>, full: boolean) => (
    <Video
      ref={ref}
      source={source}
      style={full ? styles.fullscreenVideo : [styles.inlineVideo, positionOf(Math.floor(width * 9 / 16))]}
      paused={paused || (fullscreen !== full)}
      resizeMode={fitMode}
      rate={playbackRate}
      progressUpdateInterval={250}
      bufferConfig={{ minBufferMs: 15000, maxBufferMs: 50000, bufferForPlaybackMs: 2500, bufferForPlaybackAfterRebufferMs: 5000, backBufferDurationMs: 30000, maxHeapAllocationPercent: 0.5, minBackBufferMemoryReservePercent: 0.1, minBufferMemoryReservePercent: 0.1 }}
      selectedVideoTrack={selectedVideoTrack}
      selectedAudioTrack={selectedAudioTrack === null ? { type: 'auto' } : { type: 'index', value: selectedAudioTrack }}
      selectedTextTrack={selectedTextTrack === null ? { type: 'disabled' } : { type: 'index', value: selectedTextTrack }}
      textTracks={subtitles.map((s, index) => ({ title: s.label, language: s.lang, type: 'text/vtt', uri: s.src, index, selected: subtitlesEnabled && (s.default || index === 0) }))}
      onLoad={handleLoad}
      onProgress={handleProgress}
      onBuffer={handleBuffer}
      onAudioTracks={handleAudioTracks}
      onTextTracks={handleTextTracks}
      onPlaybackStateChanged={(e) => { setBuffering(Boolean(e.isLoading)); onBuffer(Boolean(e.isLoading)); }}
      onEnd={onEnd}
      onError={handleError}
      automaticallyWaitsToMinimizeStalling
      ignoreSilentSwitch="ignore"
      playInBackground={false}
      preventsDisplaySleepDuringVideoPlayback
      repeat={false}
    />
  );

  const surface = (
    <View style={[styles.playerBox, fullscreen ? styles.fullscreenBox : null]}>
      {video(videoRef, false)}
      {!fullscreen && (
        <View style={styles.controls} pointerEvents="box-none">
          <Pressable onPress={() => onPausedChange(!paused)} style={styles.playButton}>
            <Icon name={paused ? 'play' : 'pause'} size={28} color="#fff" />
          </Pressable>
          {buffering && !paused && <ActivityIndicator size="large" color={colors.accent} />}
          <View style={styles.progressRow}>
            <Text style={styles.time}>{formatTime(time)}</Text>
            <Pressable style={styles.seekTrack} onPress={(e) => {
              const x = e.nativeEvent.locationX;
              const target = duration > 0 ? duration * x / width : 0;
              latestTime.current = target;
              setTime(target);
              videoRef.current?.seek(target);
            }}>
              <View style={[styles.seekFill, { width: `${duration > 0 ? Math.min(100, time / duration * 100) : 0}%` }]} />
            </Pressable>
            <Text style={styles.time}>{formatTime(duration)}</Text>
            <Pressable onPress={toggleFullscreen} style={styles.fullscreenButton}><Icon name="fullscreen" size={20} color="#fff" /></Pressable>
          </View>
          {tracks.filter((t) => t.type === 'audio').length > 1 && (
            <View style={styles.trackRow}>
              {tracks.filter((t) => t.type === 'audio').map((t) => <Pressable key={t.id} onPress={() => selectAudio(t.id)} style={styles.trackButton}><Text style={styles.trackText}>{t.name}</Text></Pressable>)}
            </View>
          )}
        </View>
      )}
    </View>
  );

  return (
    <>
      {surface}
      <Modal visible={fullscreen} animationType="fade" statusBarTranslucent onRequestClose={finishFullscreen}>
        <View style={styles.fullscreenBox}>
          {video(modalVideoRef, true)}
          <View style={styles.fullscreenControls} pointerEvents="box-none">
            <Pressable onPress={toggleFullscreen} style={styles.fullscreenButton}><Icon name="exitFullscreen" size={22} color="#fff" /></Pressable>
            <Pressable onPress={() => onPausedChange(!paused)} style={styles.playButton}><Icon name={paused ? 'play' : 'pause'} size={30} color="#fff" /></Pressable>
            <View style={styles.progressRow}>
              <Text style={styles.time}>{formatTime(time)}</Text>
              <Pressable style={styles.seekTrack} onPress={(e) => {
                const target = duration > 0 ? duration * e.nativeEvent.locationX / width : 0;
                latestTime.current = target;
                setTime(target);
                modalVideoRef.current?.seek(target);
              }}>
                <View style={[styles.seekFill, { width: `${duration > 0 ? Math.min(100, time / duration * 100) : 0}%` }]} />
              </Pressable>
              <Text style={styles.time}>{formatTime(duration)}</Text>
            </View>
            {buffering && !paused && <ActivityIndicator size="large" color={colors.accent} />}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  playerBox: { width: '100%', backgroundColor: '#000', aspectRatio: 16 / 9, position: 'relative', overflow: 'hidden' },
  inlineVideo: { backgroundColor: '#000' },
  fullscreenBox: { flex: 1, backgroundColor: '#000' },
  fullscreenVideo: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  controls: { ...StyleSheet.absoluteFillObject, padding: 12, justifyContent: 'space-between' },
  fullscreenControls: { ...StyleSheet.absoluteFillObject, padding: 16, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  playButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', alignSelf: 'center' },
  fullscreenButton: { padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seekTrack: { height: 4, flex: 1, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 2, overflow: 'hidden' },
  seekFill: { height: '100%', backgroundColor: colors.accent },
  time: { color: '#fff', fontSize: 11, fontVariant: ['tabular-nums'] },
  trackRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  trackButton: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#222', borderRadius: 8 },
  trackText: { color: '#fff', fontSize: 12 },
});

export default memo(PlayerSurface);
