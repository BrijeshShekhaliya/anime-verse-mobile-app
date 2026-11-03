import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { splashStage } from '@/lib/splash';
import { GradientText } from './GradientText';
import { fonts } from '@/lib/theme';

export const BRAND_LOGO = require('../../assets/logo.png');

// Wordmark colours: silver "ANIME", orange-fire "VERSE".
export const BRAND_SILVER = ['#FFFFFF', '#B9BEC9'] as const;
export const BRAND_FIRE = ['#FFC15E', '#FF640A', '#FF3B2F'] as const;

// Everything in the lockup scales with its size, so a big lockup shrunk by a
// transform looks exactly like a small one (the launch animation relies on it).
export const brandGap = (size: number) => size * 0.2;

// The wide geometric wordmark: "ANIME" in silver, "VERSE" in fire.
export function BrandWord({ size }: { size: number }) {
  const font = Math.round(size * 0.38);
  const text = { fontFamily: fonts.brand, fontSize: font, lineHeight: Math.round(font * 1.25), letterSpacing: font * 0.08 };
  return (
    <View style={styles.word}>
      <GradientText colors={BRAND_SILVER} horizontal={false} style={text}>
        ANIME
      </GradientText>
      <View style={{ width: font * 0.35 }} />
      <GradientText colors={BRAND_FIRE} style={text}>
        VERSE
      </GradientText>
    </View>
  );
}

// The AnimeVerse lockup: the logo and the wordmark, used wherever the brand
// appears so it always looks the same.
// fromSplash: this is where the launch animation's lockup lands (Home's
// header): it appears the moment the flying one arrives in the same spot.
export function Brand({ size = 40, showName = true, showLogo = true, fromSplash = false }: { size?: number; showName?: boolean; showLogo?: boolean; fromSplash?: boolean }) {
  const landed = useAnimatedStyle(() => (fromSplash ? { opacity: splashStage.value >= 1 ? 1 : 0 } : {}));
  return (
    <Animated.View style={[styles.row, { gap: brandGap(size) }, landed]} accessibilityRole="header" accessibilityLabel="AnimeVerse">
      {showLogo ? <Image source={BRAND_LOGO} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory" /> : null}
      {showName ? <BrandWord size={size} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  word: { flexDirection: 'row', alignItems: 'center' },
});
