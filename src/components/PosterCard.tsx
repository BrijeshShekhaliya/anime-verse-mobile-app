import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LangBadges, Pill, Score } from './Badges';
import { PressableScale } from './PressableScale';
import { factsOf } from '@/lib/format';
import { colors, fonts, radius } from '@/lib/theme';
import type { Anime } from '@/lib/types';

const HI_DPI = PixelRatio.get() >= 2;

// Poster card used in every row and grid. Picks the sharper image on high-DPI
// screens (the API sends a 1x and a 2x poster), fades the image in, and
// slides in with a small stagger the first time it appears.
export const PosterCard = memo(function PosterCard({
  anime,
  width = 124,
  index = 0,
  rank,
  showFacts = false,
}: {
  anime: Anime;
  width?: number;
  index?: number;
  rank?: number;
  showFacts?: boolean;
}) {
  const uri = (HI_DPI && anime.image2x) || anime.image || undefined;
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(380)} style={{ width }}>
      <PressableScale onPress={() => router.push(`/anime/${anime.id}`)} accessibilityRole="button" accessibilityLabel={anime.title}>
        <View style={[styles.poster, { width, height: width * 1.5 }]}>
          {uri ? (
            <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} cachePolicy="memory-disk" recyclingKey={anime.id} />
          ) : (
            <Text style={styles.noImg} numberOfLines={4}>
              {anime.title}
            </Text>
          )}
          {anime.airing ? (
            <View style={styles.tag}>
              <Pill label="● Airing" tone="accent" />
            </View>
          ) : /not yet|upcoming/i.test(anime.status || '') ? (
            <View style={styles.tag}>
              <Pill label="Upcoming" />
            </View>
          ) : null}
          {rank != null && <Text style={styles.rank}>{rank}</Text>}
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {anime.title}
        </Text>
        <View style={styles.sub}>
          <LangBadges anime={anime} />
          <Score value={anime.score} size={12} />
        </View>
        {showFacts && (
          <Text style={styles.facts} numberOfLines={1}>
            {factsOf(anime).join(' · ')}
          </Text>
        )}
      </PressableScale>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  poster: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2, justifyContent: 'center' },
  noImg: { color: colors.text2, fontFamily: fonts.black, fontSize: 13, textAlign: 'center', padding: 10 },
  tag: { position: 'absolute', top: 7, left: 7 },
  rank: {
    position: 'absolute',
    left: 6,
    bottom: -6,
    fontFamily: fonts.display,
    fontSize: 64,
    lineHeight: 64,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 12,
  },
  title: { marginTop: 8, color: colors.text, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  facts: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 4 },
});
