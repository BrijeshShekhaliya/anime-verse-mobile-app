import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType, Ref } from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

export type Media3Track = {
  id: number;
  name: string;
  lang: string;
  type: 'audio' | 'text';
  selected?: boolean;
};

export type Media3Level = { index: number; height: number; width: number; bitrate: number; selected?: boolean };
export type Media3Event<T = Record<string, unknown>> = { nativeEvent: T };

export type NativeMedia3ViewProps = {
  uri: string;
  referer?: string;
  paused: boolean;
  playbackRate: number;
  fitMode: "contain" | "cover" | "fill";
  selectedQualityHeight: number;
  selectedAudioTrackId?: number | null;
  preferredAudioLanguage?: string | null;
  selectedTextTrackId?: number | null;
  subtitlesEnabled: boolean;
  style?: StyleProp<ViewStyle>;
  onLoad?: (event: Media3Event<{ duration: number }>) => void;
  onProgress?: (event: Media3Event<{ time: number; duration: number; buffered: number; videoWidth?: number; videoHeight?: number }>) => void;
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

const isAvailable: boolean = (() => {
  if (Platform.OS !== 'android') {
    return false;
  }
  try {
    return Boolean(requireOptionalNativeModule('NativeMedia3Player'));
  } catch {
    return false;
  }
})();

export function isNativeMedia3Available(): boolean {
  return isAvailable;
}

export const NativeMedia3View = requireNativeViewManager<NativeMedia3ViewProps>(
  'NativeMedia3Player',
) as ComponentType<NativeMedia3ViewProps & { ref?: Ref<NativeMedia3ViewRef> }>;
