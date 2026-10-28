import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, LogoMark } from './Icon';
import { PressableScale } from './PressableScale';
import { colors, fonts } from '@/lib/theme';

// Logo + search bar floating over the hero. Transparent at the top, fades to a
// frosted bar as you scroll (like the website's nav).
export function TopBar({ scrollY, solidAfter = 80 }: { scrollY: SharedValue<number>; solidAfter?: number }) {
  const insets = useSafeAreaInsets();
  const bg = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [0, solidAfter], [0, 1], 'clamp') }));
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, bg]}>
        {Platform.OS === 'ios' ? <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'ios' ? 'rgba(14,15,19,0.78)' : 'rgba(14,15,19,0.96)' }]} />
      </Animated.View>
      <View style={styles.bar}>
        <View style={styles.brand}>
          <LogoMark size={28} />
          <Text style={styles.word}>
            Anime<Text style={{ color: colors.accent }}>Verse</Text>
          </Text>
        </View>
        <PressableScale haptic onPress={() => router.push('/search')} style={styles.search} accessibilityLabel="Search anime">
          <Icon name="search" size={20} color="#fff" />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  bar: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  word: { color: '#fff', fontFamily: fonts.black, fontSize: 19, letterSpacing: -0.3 },
  search: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
});
