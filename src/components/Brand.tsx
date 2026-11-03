import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { splashStage } from '@/lib/splash';
import { GradientText } from './GradientText';
import { fonts } from '@/lib/theme';

const LOGO = require('../../assets/logo.png');

// Wordmark colours: silver "ANIME", orange-fire "VERSE".
export const BRAND_SILVER = ['#FFFFFF', '#B9BEC9'] as const;
export const BRAND_FIRE = ['#FFC15E', '#FF640A', '#FF3B2F'] as const;

// The AnimeVerse lockup: the logo and the wide geometric wordmark, used
// wherever the brand appears so it always looks the same.
// fromSplash: this is where the launch animation's logo lands (Home's header):
// the logo appears the moment it lands, then the wordmark slides out of it.
export function Brand({ size = 40, showName = true, showLogo = true, fromSplash = false }: { size?: number; showName?: boolean; showLogo?: boolean; fromSplash?: boolean }) {
  const logoIn = useAnimatedStyle(() => (fromSplash ? { opacity: splashStage.value >= 1 ? 1 : 0 } : {}));
  const wordIn = useAnimatedStyle(() =>
    fromSplash
      ? {
          opacity: interpolate(splashStage.value, [1, 2], [0, 1], 'clamp'),
          transform: [{ translateX: interpolate(splashStage.value, [1, 2], [-14, 0], 'clamp') }],
        }
      : {}
  );
  const font = Math.round(size * 0.38);
  const text = { fontFamily: fonts.brand, fontSize: font, lineHeight: Math.round(font * 1.25), letterSpacing: font * 0.08 };
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="AnimeVerse">
      {showLogo ? (
        <Animated.View style={logoIn}>
          <Image source={LOGO} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory" />
        </Animated.View>
      ) : null}
      {showName ? (
        <Animated.View style={[styles.word, wordIn]}>
          <GradientText colors={BRAND_SILVER} horizontal={false} style={text}>
            ANIME
          </GradientText>
          <View style={{ width: font * 0.35 }} />
          <GradientText colors={BRAND_FIRE} style={text}>
            VERSE
          </GradientText>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: { flexDirection: 'row', alignItems: 'center' },
});
