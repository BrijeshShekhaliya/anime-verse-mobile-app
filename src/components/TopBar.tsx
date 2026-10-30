import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, LogoMark } from './Icon';
import { PressableScale } from './PressableScale';
import { colors, fonts } from '@/lib/theme';
import { requestSearchFocus } from '@/lib/searchFocus';

// Logo + search button floating over the hero. Transparent at the top, fades to
// a frosted bar as you scroll. Search opens Browse at once; Browse animates its
// search bar out of this button's spot (see browse.tsx).
export function TopBar({ scrollY, solidAfter = 80 }: { scrollY: SharedValue<number>; solidAfter?: number }) {
  const insets = useSafeAreaInsets();
  const bg = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [0, solidAfter], [0, 1], 'clamp') }));
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]} pointerEvents="box-none">
      <Animated.View style={[StyleSheet.absoluteFill, bg]}>
        <View style={[StyleSheet.absoluteFill, styles.solid]} />
      </Animated.View>
      <View style={styles.bar}>
        <View style={styles.brand}>
          <LogoMark size={28} />
          <Text style={styles.word}>
            Anime<Text style={{ color: colors.accent }}>Verse</Text>
          </Text>
        </View>
        <View style={styles.actions}>
          <PressableScale haptic onPress={() => router.push('/settings')} style={styles.search} accessibilityLabel="Settings">
            <Icon name="settings" size={20} color="#fff" />
          </PressableScale>
          <PressableScale
            haptic
            onPress={() => {
              requestSearchFocus();
              router.navigate('/browse');
            }}
            style={styles.search}
            accessibilityRole="search"
            accessibilityLabel="Search anime"
          >
            <Icon name="search" size={20} color="#fff" />
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

// Where the search button sits, so Browse can start its animation from it.
export const SEARCH_BUTTON = { size: 40, right: 16, barHeight: 54 };

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  // Solid black once you scroll (same as every other bar).
  solid: { backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  bar: { height: SEARCH_BUTTON.barHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SEARCH_BUTTON.right },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  word: { color: '#fff', fontFamily: fonts.black, fontSize: 19, letterSpacing: -0.3 },
  search: { width: SEARCH_BUTTON.size, height: SEARCH_BUTTON.size, borderRadius: SEARCH_BUTTON.size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
});
