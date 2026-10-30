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
import { api } from '@/lib/api';
import { posterOf, useArt, wantArt } from '@/lib/artwork';
import { useTitle } from '@/lib/settings';

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
  const { art, settled } = useArt(anime);
  const title = useTitle(anime);
  const uri = settled ? posterOf(anime, art, HI_DPI) : undefined;
  return (
    // Only the first screenful animates in; later cards (scrolling, next pages)
    // just appear, which keeps long lists smooth on slower phones.
    <Animated.View entering={index < 9 ? FadeInDown.delay(index * 40).duration(340) : undefined} style={{ width }}>
      <PressableScale onPressIn={() => wantArt([anime], true)} onPress={() => { api.seedDetail(anime); router.push(`/anime/${anime.id}`); }} accessibilityRole="button" accessibilityLabel={title}>
        <View style={[styles.poster, { width, height: width * 1.5 }]}>
          {uri ? (
            <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} cachePolicy="memory-disk" recyclingKey={anime.id} />
          ) : !settled ? null : (
            <Text style={styles.noImg} numberOfLines={4}>
              {title}
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
          {title}
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
    fontSize: 58,
    lineHeight: 62,
    letterSpacing: -3,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 12,
  },
  title: { marginTop: 8, color: colors.text, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  facts: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 4 },
});
