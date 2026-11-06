import '@/lib/quietLogs';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_800ExtraBold, Inter_900Black } from '@expo-google-fonts/inter';
import { Orbitron_900Black } from '@expo-google-fonts/orbitron';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { whenPostersReady } from '@/lib/artwork';
import { homeQuery } from '@/lib/queries';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LibraryProvider } from '@/lib/library';
import { QueryProvider, queryClient } from '@/lib/query';
import { colors } from '@/lib/theme';
import { getOrVerifyActiveDomain } from '@/services/animerulzClient';
import { SettingsProvider } from '@/lib/settings';
import { TOUR_FIRST, loadOnboarded, onboarded, tourItems } from '@/lib/onboarding';

// Anything that breaks on a screen shows a way forward instead of closing the app.
export { CrashScreen as ErrorBoundary } from '@/components/CrashScreen';

SplashScreen.preventAutoHideAsync().catch(() => {});
// The animated splash (same black, same logo) takes over with a quick cross-fade.
SplashScreen.setOptions({ fade: true, duration: 200 });
// The app is portrait-only, whatever the phone's auto-rotate setting. (Video
// players rotate to landscape themselves for fullscreen and lock back.)
ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_800ExtraBold, Inter_900Black, Orbitron_900Black });

  // The splash stays up until fonts are ready and the saved data has been read,
  // so a normal launch goes straight to a filled screen (never longer than 2s).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    getOrVerifyActiveDomain().catch(() => {});
    const t = setTimeout(() => setRestored(true), 2000);
    return () => clearTimeout(t);
  }, []);
  // Whether to show the welcome tour is known before the splash goes away. On
  // first launch the tour's first posters are downloaded while the logo plays,
  // so the tour opens with its pictures already there (3.5s at most).
  const [tourKnown, setTourKnown] = useState(false);
  const [tourReady, setTourReady] = useState(false);
  useEffect(() => {
    loadOnboarded().finally(() => {
      setTourKnown(true);
      if (onboarded() !== false) return setTourReady(true);
      queryClient
        .ensureQueryData(homeQuery)
        .then((home) => whenPostersReady(tourItems(home).slice(0, TOUR_FIRST), 3500))
        .catch(() => {})
        .finally(() => setTourReady(true));
    });
    const t = setTimeout(() => setTourReady(true), 6000);
    return () => clearTimeout(t);
  }, []);
  const ready = (fontsLoaded || !!fontError) && restored && tourKnown && tourReady;
  // The animated splash plays over the app until it's ready, then hands off.
  const [splashDone, setSplashDone] = useState(false);

  return (
    // Gesture root: the player's taps, double-taps and drags need it.
    <GestureHandlerRootView style={{ flex: 1 }}>
    <QueryProvider onRestored={() => setRestored(true)}>
      <SafeAreaProvider>
      {(!fontsLoaded && !fontError) || !tourKnown ? null : (
          <LibraryProvider>
            <SettingsProvider>
            <StatusBar style="light" />
            {/* Screen transitions: a quick native cross-fade, both when a page opens
                and when you go back (it stays smooth on any phone). */}
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                // The phone's own screen transition (Android's system open/close
                // animation, iOS's slide with swipe-back): drawn natively, so it
                // stays smooth even while the new screen is still rendering.
                animation: 'default',
                gestureEnabled: true,
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="anime/[id]" />
              <Stack.Screen name="watch/[id]" />
              <Stack.Screen name="search" />
              <Stack.Screen name="settings" />
              <Stack.Screen name="welcome" options={{ animation: 'fade', animationDuration: 300, gestureEnabled: false }} />
            </Stack>
            </SettingsProvider>
          </LibraryProvider>
      )}
      {splashDone ? null : <AnimatedSplash ready={ready} toHeader={onboarded() !== false} fontsReady={fontsLoaded || !!fontError} onDone={() => setSplashDone(true)} />}
      </SafeAreaProvider>
    </QueryProvider>
    </GestureHandlerRootView>
  );
}
