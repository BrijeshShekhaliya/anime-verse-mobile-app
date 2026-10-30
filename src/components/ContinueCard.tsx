import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInRight, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import type { Progress } from '@/lib/library';
import { colors, fonts, radius } from '@/lib/theme';
import { backdropOf, useArt } from '@/lib/artwork';
import type { Anime } from '@/lib/types';
import { useTitle } from '@/lib/settings';

export const CONTINUE_CARD_W = 286;

// Landscape card for "Continue Watching": the show's banner, which episode is
// next, and a progress bar that fills in as the row appears.
export function ContinueCard({ item, index = 0, width = CONTINUE_CARD_W }: { item: Progress; index?: number; width?: number }) {
  const a = item.anime;
  const { art: tmdb } = useArt(a as Anime, true);
  const title = useTitle(a);
  const art = backdropOf(a as Anime, tmdb);
  const isCompleted = Boolean(item.completed);
  const done = Boolean(item.total && item.episode >= item.total && isCompleted);
  // If completed, prompt next episode; if paused/stopped halfway, continue THIS episode!
  const targetEp = done ? item.episode : isCompleted ? item.episode + 1 : item.episode;
  const pct = item.total
    ? Math.min(
        1,
        (isCompleted
          ? item.episode
          : Math.max(0, item.episode - 1 + (item.duration && item.duration > 0 ? (item.time || 0) / item.duration : 0.5))) /
          item.total,
      )
    : 0;
  const left = item.total ? Math.max(0, item.total - (isCompleted ? item.episode : item.episode - 1)) : null;

  // Progress fills from empty (transform only: no layout work per frame).
  const reduce = useReducedMotion();
  const fill = useSharedValue(reduce ? pct : 0);
  useEffect(() => {
    fill.value = reduce ? pct : withDelay(250 + Math.min(index, 5) * 90, withTiming(pct, { duration: 750, easing: Easing.out(Easing.cubic) }));
  }, [pct, index, reduce, fill]);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.02, fill.value) }] }));

  return (
    <Animated.View entering={reduce ? undefined : FadeInRight.delay(Math.min(index, 5) * 70).duration(420)} style={{ width }}>
      <PressableScale
        onPress={() => router.push(`/watch/${a.id}?ep=${targetEp}` as any)}
        scaleTo={0.97}
        accessibilityLabel={`Continue ${title}, episode ${targetEp}`}
      >
        <View style={[styles.art, { height: Math.round(width * 0.56) }]}>
          {art ? (
            <Image source={{ uri: art }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} cachePolicy="memory-disk" recyclingKey={a.id} />
          ) : null}
          <LinearGradient colors={['rgba(0,0,0,0.35)', 'transparent', 'rgba(0,0,0,0.9)']} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />

          <View style={styles.epChip}>
            <Text style={styles.epChipText}>{done ? 'FINISHED' : `EP ${targetEp}`}</Text>
          </View>

          <View style={styles.playWrap} pointerEvents="none">
            <View style={styles.play}>
              <Icon name="play" size={18} color="#fff" />
            </View>
          </View>

          <View style={styles.bottom}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {done ? 'All episodes watched' : `Episode ${targetEp}`}
              {left ? <Text style={styles.metaDim}>{`  ·  ${left} left`}</Text> : null}
            </Text>
          </View>

          <View style={styles.track}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
        </View>
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
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 14 },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 15.5 },
  meta: { marginTop: 2, color: colors.accent, fontFamily: fonts.bold, fontSize: 12.5 },
  metaDim: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.regular },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.18)' },
  fill: { height: '100%', width: '100%', backgroundColor: colors.accent, transformOrigin: 'left' },
});
