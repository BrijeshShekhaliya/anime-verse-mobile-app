import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { GradientText } from './GradientText';
import { fonts } from '@/lib/theme';

const LOGO = require('../../assets/logo.png');

// Wordmark colours: silver "ANIME", orange-fire "VERSE".
export const BRAND_SILVER = ['#FFFFFF', '#B9BEC9'] as const;
export const BRAND_FIRE = ['#FFC15E', '#FF640A', '#FF3B2F'] as const;

// The AnimeVerse lockup: the logo and the wide geometric wordmark, used
// wherever the brand appears so it always looks the same.
export function Brand({ size = 40, showName = true, showLogo = true }: { size?: number; showName?: boolean; showLogo?: boolean }) {
  const font = Math.round(size * 0.38);
  const text = { fontFamily: fonts.brand, fontSize: font, lineHeight: Math.round(font * 1.25), letterSpacing: font * 0.08 };
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="AnimeVerse">
      {showLogo ? <Image source={LOGO} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory" /> : null}
      {showName ? (
        <View style={styles.word}>
          <GradientText colors={BRAND_SILVER} horizontal={false} style={text}>
            ANIME
          </GradientText>
          <View style={{ width: font * 0.35 }} />
          <GradientText colors={BRAND_FIRE} style={text}>
            VERSE
          </GradientText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: { flexDirection: 'row', alignItems: 'center' },
});
