import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { LangBadges, Score } from './Badges';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { useLibrary } from '@/lib/library';
import { factsOf } from '@/lib/format';
import { colors, fonts, radius } from '@/lib/theme';
import type { Anime } from '@/lib/types';

const AUTO_MS = 6500;

function Slide({ anime, index, width, height, scrollX }: { anime: Anime; index: number; width: number; height: number; scrollX: SharedValue<number> }) {
  const { inList, toggleList } = useLibrary();
  const saved = inList(anime.id);
  const art = anime.backdrop || anime.banner || anime.image || undefined;

  // The artwork moves slower than the swipe (parallax); the text fades as the slide leaves.
  const artStyle = useAnimatedStyle(() => {
    const p = (scrollX.value - index * width) / width;
    return { transform: [{ translateX: interpolate(p, [-1, 0, 1], [-width * 0.35, 0, width * 0.35], Extrapolation.CLAMP) }, { scale: 1.08 }] };
  });
  const textStyle = useAnimatedStyle(() => {
    const p = Math.abs((scrollX.value - index * width) / width);
    return { opacity: interpolate(p, [0, 0.6], [1, 0], Extrapolation.CLAMP), transform: [{ translateY: interpolate(p, [0, 1], [0, 24]) }] };
  });

  const facts = factsOf(anime);
  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, artStyle]}>
        {art && <Image source={{ uri: art }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="center" transition={300} cachePolicy="memory-disk" />}
      </Animated.View>
      <LinearGradient colors={['rgba(0,0,0,0.55)', 'transparent', 'rgba(0,0,0,0.55)', '#000']} locations={[0, 0.25, 0.62, 1]} style={StyleSheet.absoluteFill} />
      <Animated.View style={[styles.content, textStyle]}>
        {anime.logo ? (
          <Image source={{ uri: anime.logo }} style={styles.logo} contentFit="contain" contentPosition="center" transition={250} />
        ) : (
          <Text style={styles.title} numberOfLines={2}>
            {anime.title}
          </Text>
        )}
        <View style={styles.meta}>
          <Score value={anime.score} size={13} />
          <LangBadges anime={anime} />
          {facts.length ? <Text style={styles.metaText}>{facts.join(' · ')}</Text> : null}
        </View>
        {anime.genres?.length ? <Text style={styles.genres}>{anime.genres.slice(0, 3).join(' • ')}</Text> : null}
        <View style={styles.actions}>
          <PressableScale haptic style={styles.primary} onPress={() => router.push(`/anime/${anime.id}`)}>
            <Icon name="info" size={18} color="#000" />
            <Text style={styles.primaryText}>Details</Text>
          </PressableScale>
          <PressableScale
            style={styles.ghost}
            onPress={() => {
              const added = toggleList(anime);
              if (Platform.OS !== 'web') Haptics.notificationAsync(added ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
            }}
            accessibilityLabel={saved ? 'Remove from My List' : 'Add to My List'}
          >
            <Icon name={saved ? 'bookmarkOn' : 'bookmark'} size={20} color={saved ? colors.accent : '#fff'} />
          </PressableScale>
        </View>
      </Animated.View>
    </View>
  );
}

function Dot({ i, active, width }: { i: number; active: number; width: number }) {
  const on = i === active;
  const w = useSharedValue(on ? 22 : 7);
  useEffect(() => {
    w.value = withTiming(on ? 22 : 7, { duration: 280 });
  }, [on, w]);
  const style = useAnimatedStyle(() => ({ width: w.value }));
  return <Animated.View style={[styles.dot, on && styles.dotOn, style]} key={`${i}-${width}`} />;
}

export function Hero({ items }: { items: Anime[] }) {
  const { width } = useWindowDimensions();
  const height = Math.min(620, Math.round(width * 1.28));
  const listRef = useAnimatedRef<Animated.FlatList<Anime>>();
  const scrollX = useSharedValue(0);
  const [active, setActive] = useState(0);
  const touching = useRef(false);

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });
  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => setActive(Math.round(e.nativeEvent.contentOffset.x / width)),
    [width]
  );

  // Advance on its own; pauses while the user is touching the carousel.
  useEffect(() => {
    if (items.length < 2) return;
    const t = setTimeout(() => {
      if (touching.current) return;
      const next = (active + 1) % items.length;
      listRef.current?.scrollToOffset({ offset: next * width, animated: true });
      setActive(next);
    }, AUTO_MS);
    return () => clearTimeout(t);
  }, [active, items.length, width, listRef]);

  if (!items.length) return null;
  return (
    <View style={{ height }}>
      <Animated.FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        keyExtractor={(a) => a.id}
        renderItem={({ item, index }) => <Slide anime={item} index={index} width={width} height={height} scrollX={scrollX} />}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumEnd}
        onTouchStart={() => (touching.current = true)}
        onTouchEnd={() => (touching.current = false)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
      />
      <View style={styles.dots} pointerEvents="none">
        {items.map((a, i) => (
          <Dot key={a.id} i={i} active={active} width={width} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { position: 'absolute', left: 20, right: 20, bottom: 46, alignItems: 'center' },
  logo: { width: '78%', height: 92, marginBottom: 12 },
  title: { fontFamily: fonts.display, fontSize: 46, lineHeight: 46, color: '#fff', textAlign: 'center', marginBottom: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  metaText: { color: colors.text2, fontFamily: fonts.bold, fontSize: 12.5 },
  genres: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12.5, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%', justifyContent: 'center' },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    height: 46,
    borderRadius: radius.md,
    paddingHorizontal: 30,
    minWidth: 200,
  },
  primaryText: { color: '#000', fontFamily: fonts.black, fontSize: 14, letterSpacing: 0.6, textTransform: 'uppercase' },
  ghost: { width: 46, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  dots: { position: 'absolute', bottom: 18, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { backgroundColor: colors.accent },
});
