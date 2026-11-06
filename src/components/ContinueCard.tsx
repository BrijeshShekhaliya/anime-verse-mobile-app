import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { nav } from '@/lib/nav';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInDown, FadeInRight, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import type { Progress } from '@/lib/library';
import { colors, fonts, radius } from '@/lib/theme';
import { api } from '@/lib/api';
import { backdropOf, useArt } from '@/lib/artwork';
import type { Anime } from '@/lib/types';
import { useTitle } from '@/lib/settings';
import { useEpisodeStill } from '@/lib/queries';
import { continueState } from '@/lib/resume';

const clock = (seconds: number) => {
  const t = Math.floor(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export const CONTINUE_CARD_W = 286;

// Landscape card for "Continue Watching": the episode's picture, which episode is
// next, and a progress bar that fills in as the row appears.
// compact: the smaller grid card (My List → Continue, two per row): the title
// sits under the picture instead of over it.
export function ContinueCard({ item, index = 0, width = CONTINUE_CARD_W, compact = false }: { item: Progress; index?: number; width?: number; compact?: boolean }) {
  const a = item.anime;
  const { art: tmdb, settled } = useArt(a as Anime, true);
  const title = useTitle(a);
  // If completed, prompt next episode; if paused/stopped halfway, continue THIS episode!
  const { done, targetEp, fraction: pct, position, left } = continueState(item);
  // The picture of the episode this opens. The show's banner only if it has none, and only
  // once that's known, so one is never shown and then swapped for the other.
  const episode = useEpisodeStill(a as Anime, item.season ?? 1, targetEp);
  const sharp = compact ? episode.still : episode.still?.replace('/w300/', '/w500/');
  const art = sharp || (settled && !episode.pending ? backdropOf(a as Anime, tmdb, true) : undefined);
  const detail = position ? `  ·  ${clock(position.time)} / ${clock(position.duration)}` : left ? `  ·  ${left} left` : null;

  // Progress fills from empty (transform only: no layout work per frame).
  const reduce = useReducedMotion();
  const fill = useSharedValue(reduce ? pct : 0);
  useEffect(() => {
    fill.value = reduce ? pct : withDelay(250 + Math.min(index, 5) * 90, withTiming(pct, { duration: 750, easing: Easing.out(Easing.cubic) }));
  }, [pct, index, reduce, fill]);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.02, fill.value) }] }));

  return (
    <Animated.View entering={reduce ? undefined : compact ? FadeInDown.delay(Math.min(index, 7) * 50).duration(340) : FadeInRight.delay(Math.min(index, 5) * 70).duration(420)} style={{ width }}>
      <PressableScale
        onPress={() => {
          api.seedDetail(a as Anime); // the player knows the title at once
          nav.push(`/watch/${a.id}?season=${item.season ?? 1}&ep=${targetEp}` as any);
        }}
        scaleTo={0.97}
        accessibilityLabel={`Continue ${title}, episode ${targetEp}`}
      >
        <View style={[styles.art, { height: Math.round(width * 0.56) }]}>
          {art ? (
            <Image source={{ uri: art }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} cachePolicy="memory-disk" recyclingKey={`${a.id}:${targetEp}`} />
          ) : null}
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.9)']} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />

          <View style={styles.epChip}>
            <Text style={styles.epChipText}>{done ? 'FINISHED' : `EP ${targetEp}`}</Text>
          </View>

          <View style={styles.playWrap} pointerEvents="none">
            <View style={[styles.play, compact && styles.playSmall]}>
              <Icon name="play" size={compact ? 14 : 18} color="#fff" />
            </View>
          </View>

          {compact ? null : (
          <View style={styles.bottom}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {done ? 'All episodes watched' : `Episode ${targetEp}`}
              {detail ? <Text style={styles.metaDim}>{detail}</Text> : null}
            </Text>
          </View>
          )}

          <View style={styles.track}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
        </View>
        {compact ? (
          <View style={styles.below}>
            <Text style={styles.belowTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.belowMeta} numberOfLines={1}>
              {done ? 'All watched' : `Episode ${targetEp}`}
              {detail ? <Text style={styles.metaDim}>{detail}</Text> : null}
            </Text>
          </View>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  epChip: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 8, height: 22, borderRadius: 6, backgroundColor: colors.accent, justifyContent: 'center' },
  epChipText: { color: '#000', fontFamily: fonts.black, fontSize: 11, letterSpacing: 0.6 },
  playWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  play: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 3, // optical centre for the play triangle
  },
  playSmall: { width: 34, height: 34, borderRadius: 17, paddingLeft: 2 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 14 },
  below: { marginTop: 8, paddingHorizontal: 2 },
  belowTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 13.5 },
  belowMeta: { marginTop: 2, color: colors.accent, fontFamily: fonts.medium, fontSize: 12 },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 15.5 },
  meta: { marginTop: 2, color: colors.accent, fontFamily: fonts.bold, fontSize: 12.5 },
  metaDim: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.regular },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
  fill: { height: '100%', width: '100%', backgroundColor: colors.accent, transformOrigin: 'left' },
});
