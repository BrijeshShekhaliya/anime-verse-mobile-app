import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
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

function Slide({ anime, index, width, height, scrollX, active }: { anime: Anime; index: number; width: number; height: number; scrollX: SharedValue<number>; active: boolean }) {
  const { inList, toggleList } = useLibrary();
  const saved = inList(anime.id);
  const art = anime.backdrop || anime.banner || anime.image || undefined;

  // Slow zoom-out on the slide that's showing (like the website's hero).
  // Skipped when the phone's "reduce motion" setting is on.
  const zoom = useSharedValue(1.12);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(zoom);
      zoom.value = 1.04;
      return;
    }
    if (active) {
      zoom.value = 1.12;
      zoom.value = withTiming(1.02, { duration: AUTO_MS + 1500, easing: Easing.linear });
    } else {
      cancelAnimation(zoom);
      zoom.value = 1.12;
    }
  }, [active, zoom, reduceMotion]);

  // The artwork moves slower than the swipe (parallax); the text fades as the slide leaves.
  const artStyle = useAnimatedStyle(() => {
    const p = (scrollX.value - index * width) / width;
    return { transform: [{ translateX: interpolate(p, [-1, 0, 1], [-width * 0.35, 0, width * 0.35], Extrapolation.CLAMP) }, { scale: zoom.value }] };
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

// Page dots. The current one widens and fills up as its time runs out
// (same as the website's progress dots).
function Dot({ on, progress }: { on: boolean; progress: SharedValue<number> }) {
  const w = useSharedValue(on ? 26 : 7);
  useEffect(() => {
    w.value = withTiming(on ? 26 : 7, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [on, w]);
  const box = useAnimatedStyle(() => ({ width: w.value }));
  const fill = useAnimatedStyle(() => ({ width: on ? `${progress.value * 100}%` : '0%' }));
  return (
    <Animated.View style={[styles.dot, box]}>
      <Animated.View style={[styles.dotFill, fill]} />
    </Animated.View>
  );
}

export function Hero({ items }: { items: Anime[] }) {
  const { width } = useWindowDimensions();
  const height = Math.min(620, Math.round(width * 1.28));
  const listRef = useAnimatedRef<Animated.FlatList<Anime>>();
  const scrollX = useSharedValue(0);
  const progress = useSharedValue(0);
  const [active, setActive] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(true);
  const activeRef = useRef(0);
  activeRef.current = active;

  // Pause while another tab or screen is on top.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const goTo = useCallback(
    (i: number) => {
      listRef.current?.scrollToOffset({ offset: i * width, animated: true });
      setActive(i);
    },
    [listRef, width]
  );
  const advance = useCallback(() => goTo((activeRef.current + 1) % items.length), [goTo, items.length]);

  // The active dot fills over AUTO_MS; when it's full, move to the next slide.
  // Driven by the animation itself, so it can't get stuck the way a timer plus
  // touch tracking can when the page is scrolled.
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (items.length < 2 || dragging || !focused) return;
    progress.value = withTiming(1, { duration: AUTO_MS, easing: Easing.linear }, (done) => {
      if (done) runOnJS(advance)();
    });
  }, [active, dragging, focused, items.length, advance, progress]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      setActive(Math.round(e.nativeEvent.contentOffset.x / width));
      setDragging(false);
    },
    [width]
  );

  if (!items.length) return null;
  return (
    <View style={{ height }}>
      <Animated.FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        keyExtractor={(a, i) => `${a.id}-${i}`}
        renderItem={({ item, index }) => <Slide anime={item} index={index} width={width} height={height} scrollX={scrollX} active={index === active && focused} />}
        extraData={`${active}-${focused}`}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => setDragging(true)}
        onScrollEndDrag={(e) => {
          // A swipe that doesn't fling still has to resume the autoplay.
          const x = e.nativeEvent.contentOffset.x;
          if (Math.abs(x / width - Math.round(x / width)) < 0.02) {
            setActive(Math.round(x / width));
            setDragging(false);
          }
        }}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={2}
        windowSize={3}
      />
      <View style={styles.dots} pointerEvents="none">
        {items.map((a, i) => (
          <Dot key={`${a.id}-${i}`} on={i === active} progress={progress} />
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
  dot: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  dotFill: { height: '100%', backgroundColor: colors.accent },
});
