import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { colors, fonts } from '@/lib/theme';

const EASE = Easing.out(Easing.cubic);
// Live blur is cheap on iOS but costly on Android (it re-blurs every frame while
// content scrolls behind it), so Android gets a near-solid bar instead.
const USE_BLUR = Platform.OS === 'ios';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home' },
  { name: 'browse', title: 'Browse', icon: 'browse' },
  { name: 'schedule', title: 'Schedule', icon: 'calendar' },
  { name: 'library', title: 'My List', icon: 'list' },
];

function TabItem({ tab, focused, onPress }: { tab: (typeof TABS)[number]; focused: boolean; onPress: () => void }) {
  // Selected icon lifts slightly; a short eased move, no bounce.
  const lift = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    lift.value = withTiming(focused ? 1 : 0, { duration: 200, easing: EASE });
  }, [focused, lift]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -2 * lift.value }, { scale: 1 + 0.08 * lift.value }] }));
  const color = focused ? colors.accent : colors.muted;
  return (
    <Pressable onPress={onPress} style={styles.item} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={tab.title}>
      <Animated.View style={style}>
        <Icon name={tab.icon} size={24} color={color} />
      </Animated.View>
      <Text style={[styles.label, { color }]}>{tab.title}</Text>
    </Pressable>
  );
}

// Tab bar with an orange indicator that glides to the active tab.
// Expo Router (SDK 58) gives a custom tab bar `emitter` and `navigateToTab`,
// not a `navigation` object.
function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tabW = width / TABS.length;
  const x = useSharedValue(state.index * tabW);
  useEffect(() => {
    x.value = withTiming(state.index * tabW, { duration: 240, easing: EASE });
  }, [state.index, tabW, x]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + tabW / 2 - 14 }] }));

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {USE_BLUR ? <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: USE_BLUR ? 'rgba(14,15,19,0.86)' : 'rgba(14,15,19,0.97)' }]} />
      <Animated.View style={[styles.indicator, indicator]} />
      <View style={styles.row}>
        {TABS.map((tab, i) => {
          const route = state.routes.find((r) => r.name === tab.name);
          const focused = state.index === i;
          return (
            <TabItem
              key={tab.name}
              tab={tab}
              focused={focused}
              onPress={() => {
                if (!route) return;
                const ev = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                if (!focused && !ev.defaultPrevented) navigateToTab(route.key);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    // freezeOnBlur: tabs you leave stop re-rendering, so switching stays smooth.
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg }, freezeOnBlur: true }} tabBar={(props) => <TabBar {...props} />}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  row: { flexDirection: 'row', paddingTop: 8 },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  label: { fontFamily: fonts.bold, fontSize: 11 },
  indicator: { position: 'absolute', top: 0, left: 0, width: 28, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: colors.accent },
});
