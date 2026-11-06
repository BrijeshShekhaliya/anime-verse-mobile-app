import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Shown instead of a crash: whatever broke on a screen, the app stays open and offers a
// way forward. Deliberately simple (no fonts, data or animation of its own) so that it
// can't fail the same way the screen did.
export function CrashScreen({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => {
    console.log(`[Crash] ${error?.message}\n${error?.stack ?? ''}`);
  }, [error]);

  const leave = () => {
    try {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch {
      retry();
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.text}>Your saved shows and progress are safe.</Text>
      <Pressable onPress={retry} style={styles.primary} accessibilityRole="button">
        <Text style={styles.primaryText}>Try again</Text>
      </Pressable>
      <Pressable onPress={leave} style={styles.secondary} accessibilityRole="button">
        <Text style={styles.secondaryText}>Go back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#000' },
  title: { color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  text: { color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 8, textAlign: 'center' },
  primary: { marginTop: 24, paddingHorizontal: 28, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF640A' },
  primaryText: { color: '#000', fontSize: 15, fontWeight: '800' },
  secondary: { marginTop: 8, paddingHorizontal: 28, height: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600' },
});
