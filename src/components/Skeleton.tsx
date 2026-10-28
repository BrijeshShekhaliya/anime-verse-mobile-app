import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors, radius } from '@/lib/theme';

// Grey placeholder with a soft light sweep while content loads.
export function Skeleton({ width, height, style, rounded = radius.sm }: { width?: DimensionValue; height?: DimensionValue; style?: StyleProp<ViewStyle>; rounded?: number }) {
  const x = useSharedValue(-1);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, [x]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: `${x.value * 100}%` }] }));
  return (
    <View style={[{ width, height, borderRadius: rounded, backgroundColor: colors.surface2, overflow: 'hidden' }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, sweep]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.07)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

export function RowSkeleton() {
  return (
    <View style={{ marginBottom: 28 }}>
      <Skeleton width={170} height={20} style={{ marginLeft: 16, marginBottom: 14 }} />
      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i}>
            <Skeleton width={120} height={180} rounded={radius.md} />
            <Skeleton width={96} height={12} style={{ marginTop: 10 }} />
          </View>
        ))}
      </View>
    </View>
  );
}
