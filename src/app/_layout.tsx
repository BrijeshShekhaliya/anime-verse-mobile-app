import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_800ExtraBold, Inter_900Black } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LibraryProvider } from '@/lib/library';
import { QueryProvider } from '@/lib/query';
import { colors } from '@/lib/theme';
import { getOrVerifyActiveDomain } from '@/services/animerulzClient';
import { SettingsProvider } from '@/lib/settings';

SplashScreen.preventAutoHideAsync().catch(() => {});
SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_800ExtraBold, Inter_900Black });

  // The splash stays up until fonts are ready and the saved data has been read,
  // so a normal launch goes straight to a filled screen (never longer than 2s).
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    getOrVerifyActiveDomain().catch(() => {});
    const t = setTimeout(() => setRestored(true), 2000);
    return () => clearTimeout(t);
  }, []);
  const ready = (fontsLoaded || !!fontError) && restored;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  return (
    <QueryProvider onRestored={() => setRestored(true)}>
      {!fontsLoaded && !fontError ? null : (
        <SafeAreaProvider>
          <LibraryProvider>
            <SettingsProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="anime/[id]" />
              <Stack.Screen name="watch/[id]" options={{ animation: 'fade' }} />
              <Stack.Screen name="search" options={{ animation: 'fade_from_bottom' }} />
              <Stack.Screen name="settings" />
            </Stack>
            </SettingsProvider>
          </LibraryProvider>
        </SafeAreaProvider>
      )}
    </QueryProvider>
  );
}
