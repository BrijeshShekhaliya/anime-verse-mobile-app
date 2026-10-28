import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { colors, fonts, springs } from '@/lib/theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home' },
  { name: 'browse', title: 'Browse', icon: 'browse' },
  { name: 'schedule', title: 'Schedule', icon: 'calendar' },
  { name: 'library', title: 'My List', icon: 'list' },
];

type BarProps = { state: { index: number; routes: { key: string; name: string }[] }; navigation: { emit: (e: any) => any; navigate: (name: string) => void } };

function TabItem({ tab, focused, onPress }: { tab: (typeof TABS)[number]; focused: boolean; onPress: () => void }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (focused) {
      scale.value = 0.82;
      scale.value = withSpring(1, springs.bouncy);
    }
  }, [focused, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
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

// Frosted tab bar with an orange indicator that springs to the active tab.
function TabBar({ state, navigation }: BarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tabW = width / TABS.length;
  const x = useSharedValue(state.index * tabW);
  useEffect(() => {
    x.value = withSpring(state.index * tabW, springs.soft);
  }, [state.index, tabW, x]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value + tabW / 2 - 14 }] }));

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(14,15,19,0.86)' }]} />
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
                const ev = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
                if (!focused && !ev.defaultPrevented) navigation.navigate(route.name);
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
    <Tabs screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }} tabBar={(props) => <TabBar {...(props as unknown as BarProps)} />}>
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
