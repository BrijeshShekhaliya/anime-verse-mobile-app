import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export type Media3Track = {
  id: number;
  name: string;
  lang: string;
  type: 'audio' | 'text';
};

export type Media3Level = { index: number; height: number; width: number; bitrate: number };
export type Media3Event<T = Record<string, unknown>> = { nativeEvent: T };

export type NativeMedia3ViewProps = {
  uri: string;
  referer?: string;
  paused: boolean;
  playbackRate: number;
  selectedQualityHeight: number;
  selectedAudioTrackId?: number | null;
  selectedTextTrackId?: number | null;
  subtitlesEnabled: boolean;
  style?: StyleProp<ViewStyle>;
  onLoad?: (event: Media3Event<{ duration: number }>) => void;
  onProgress?: (event: Media3Event<{ time: number; duration: number; buffered: number }>) => void;
  onBuffer?: (event: Media3Event<{ buffering: boolean }>) => void;
  onAudioTracks?: (event: Media3Event<{ tracks: Media3Track[] }>) => void;
  onTextTracks?: (event: Media3Event<{ tracks: Media3Track[] }>) => void;
  onVideoTracks?: (event: Media3Event<{ levels: Media3Level[] }>) => void;
  onEnd?: () => void;
  onError?: (event: Media3Event<{ message: string }>) => void;
};

export type NativeMedia3ViewRef = {
  seek: (time: number) => void;
};

export const NativeMedia3View = requireNativeViewManager<NativeMedia3ViewProps>(
  'NativeMedia3Player',
) as ComponentType<NativeMedia3ViewProps & { ref?: React.Ref<NativeMedia3ViewRef> }>;
