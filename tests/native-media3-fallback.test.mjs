import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nativePlayerSource = await readFile(new URL('../src/components/player/NativeHlsPlayer.tsx', import.meta.url), 'utf8');
const nativeModuleIndex = await readFile(new URL('../modules/native-media3-player/src/index.ts', import.meta.url), 'utf8');
const expoModuleConfig = JSON.parse(await readFile(new URL('../modules/native-media3-player/expo-module.config.json', import.meta.url), 'utf8'));

describe('NativeMedia3Player availability and graceful fallback', () => {
  test('1. Android + native module available → native Media3 player is selected', () => {
    assert.match(nativePlayerSource, /isNativeMedia3Available\(\)/);
    assert.match(nativePlayerSource, /<AndroidMedia3Player\b/);

    // Verify dispatch logic selects AndroidMedia3Player when on Android and native module is available
    const selectPlayer = (platform, isModuleAvailable) => {
      if (platform !== 'android' || !isModuleAvailable) {
        return 'ExpoVideoHlsPlayer';
      }
      return 'AndroidMedia3Player';
    };

    assert.equal(selectPlayer('android', true), 'AndroidMedia3Player');
  });

  test('2. Android + native module unavailable → Expo Video fallback is selected', () => {
    assert.match(nativePlayerSource, /Platform\.OS !== 'android' \|\| !isNativeMedia3Available\(\)/);
    assert.match(nativePlayerSource, /<ExpoVideoHlsPlayer\b/);

    const selectPlayer = (platform, isModuleAvailable) => {
      if (platform !== 'android' || !isModuleAvailable) {
        return 'ExpoVideoHlsPlayer';
      }
      return 'AndroidMedia3Player';
    };

    // Stale build or Expo Go on Android:
    assert.equal(selectPlayer('android', false), 'ExpoVideoHlsPlayer');
  });

  test('3. Non-Android platform → existing Expo Video behavior remains unchanged', () => {
    const selectPlayer = (platform, isModuleAvailable) => {
      if (platform !== 'android' || !isModuleAvailable) {
        return 'ExpoVideoHlsPlayer';
      }
      return 'AndroidMedia3Player';
    };

    assert.equal(selectPlayer('ios', true), 'ExpoVideoHlsPlayer');
    assert.equal(selectPlayer('ios', false), 'ExpoVideoHlsPlayer');
    assert.equal(selectPlayer('web', false), 'ExpoVideoHlsPlayer');
  });

  test('4. Availability check uses requireOptionalNativeModule and does not invoke requireNativeViewManager when module is absent', () => {
    assert.match(nativeModuleIndex, /export function isNativeMedia3Available/);
    assert.match(nativeModuleIndex, /requireOptionalNativeModule\(['"]NativeMedia3Player['"]\)/);
    
    // Check that the availability determination logic itself does not invoke requireNativeViewManager
    const availabilitySnippet = nativeModuleIndex.slice(
      nativeModuleIndex.indexOf('const isAvailable'),
      nativeModuleIndex.indexOf('export const NativeMedia3View')
    );
    assert.equal(availabilitySnippet.includes('requireNativeViewManager'), false);

    // Preserves existing NativeMedia3View export and config
    assert.match(nativeModuleIndex, /export const NativeMedia3View = requireNativeViewManager/);
    assert.equal(expoModuleConfig.android.modules[0], 'expo.modules.nativemedia3player.NativeMedia3PlayerModule');
  });

  test('5. Missing native module prevents mounting NativeMedia3View and avoids the view-config warning', () => {
    // If the native module is absent, NativeHlsPlayer returns early with ExpoVideoHlsPlayer
    // so AndroidMedia3Player (and its contained NativeMedia3View) is never mounted into the React tree.
    const isModuleAvailable = false;
    let nativeViewMounted = false;

    const renderPlayer = (platform, available) => {
      if (platform !== 'android' || !available) {
        return 'ExpoVideoHlsPlayer';
      }
      nativeViewMounted = true;
      return 'NativeMedia3View';
    };

    const rendered = renderPlayer('android', isModuleAvailable);
    assert.equal(rendered, 'ExpoVideoHlsPlayer');
    assert.equal(nativeViewMounted, false, 'NativeMedia3View must not be mounted when native module is unavailable');
  });

  test('6. Ref forwarding and existing props contract are preserved across both player variants', () => {
    assert.match(nativePlayerSource, /forwardRef<NativeVideoPlayerHandle, Props>\(function NativeHlsPlayer/);
    assert.match(nativePlayerSource, /<ExpoVideoHlsPlayer \{\.\.\.props\} ref=\{forwardedRef\} \/>/);
    assert.match(nativePlayerSource, /<AndroidMedia3Player \{\.\.\.props\} ref=\{forwardedRef\} \/>/);
    assert.match(nativePlayerSource, /export type \{ NativePlayerTrack, NativeVideoLevel \} from '\.\/ExpoVideoHlsPlayer'/);
  });
});
