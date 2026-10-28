import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LangBadges } from '@/components/Badges';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { ErrorState } from '@/components/States';
import { api } from '@/lib/api';
import { factsOf } from '@/lib/format';
import { useLibrary } from '@/lib/library';
import { colors, fonts, radius, springs } from '@/lib/theme';
import type { AnimeDetail } from '@/lib/types';
import { useFetch } from '@/lib/useFetch';

const haptic = (kind: 'tap' | 'success' | 'warn' = 'tap') => {
  if (Platform.OS === 'web') return;
  if (kind === 'tap') Haptics.selectionAsync().catch(() => {});
  else Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
};

const openLink = (url: string) => {
  if (Platform.OS === 'web') Linking.openURL(url);
  else WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
};

export default function DetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const heroH = Math.min(460, Math.round(width * 0.95));
  const { data: a, error, loading, reload } = useFetch(() => api.detail(String(id)), [id]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  // Backdrop scrolls at half speed and stretches when you pull down.
  const artStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    return {
      transform: [
        { translateY: y > 0 ? y * 0.5 : y / 2 },
        { scale: y < 0 ? 1 + -y / heroH : 1 },
      ],
    };
  });
  const barStyle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [heroH - 160, heroH - 80], [0, 1], Extrapolation.CLAMP) }));

  if (loading && !a) return <DetailSkeleton heroH={heroH} />;
  if (error && !a) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 60 }]}>
        <BackButton top={insets.top} />
        <ErrorState message={error} onRetry={reload} />
      </View>
    );
  }
  if (!a) return null;

  const art = a.backdrop || a.banner || a.image || undefined;
  const poster = a.tmdbPoster || a.image || undefined;
  const kicker = a.type === 'Movie' ? 'Movie' : a.seasonCount ? 'Series' : a.type || 'Anime';
  const facts = [
    ...factsOf(a, true),
    a.tmdbStatus || (a.status ? a.status.replace('Currently Airing', 'Airing').replace('Finished Airing', 'Ended') : ''),
  ].filter(Boolean);

  return (
    <View style={styles.screen}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* Backdrop: clipped to its box so the parallax never slides over the title. */}
        <View style={{ height: heroH, overflow: 'hidden' }}>
          <Animated.View style={[StyleSheet.absoluteFill, artStyle]}>
            {art && <Image source={{ uri: art }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} cachePolicy="memory-disk" />}
          </Animated.View>
          <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.6)', '#000']} locations={[0, 0.3, 0.7, 1]} style={StyleSheet.absoluteFill} />
        </View>

        {/* Header block, overlapping the bottom of the backdrop */}
        <View style={[styles.head, { marginTop: -170 }]}>
          <Animated.View entering={FadeInDown.duration(500)} style={styles.posterWrap}>
            {poster && <Image source={{ uri: poster }} style={styles.poster} contentFit="cover" transition={250} />}
          </Animated.View>
          <Animated.Text entering={FadeInDown.delay(60).duration(450)} style={styles.kicker}>
            {kicker.toUpperCase()}
            {a.airing ? '  ·  AIRING' : ''}
          </Animated.Text>
          <Animated.View entering={FadeInDown.delay(110).duration(450)} style={{ alignItems: 'center', width: '100%' }}>
            {a.logo ? (
              <Image source={{ uri: a.logo }} style={styles.logo} contentFit="contain" transition={250} accessibilityLabel={a.title} />
            ) : (
              <Text style={styles.title}>{a.title}</Text>
            )}
          </Animated.View>
          {a.titleRomaji && a.titleRomaji !== a.title ? <Text style={styles.alt}>{a.titleRomaji}</Text> : null}
          <Animated.View entering={FadeInDown.delay(170).duration(450)} style={styles.factRow}>
            {a.score ? (
              <View style={styles.scoreChip}>
                <Icon name="star" size={14} color={colors.star} />
                <Text style={styles.scoreText}>{a.score.toFixed(1)}</Text>
              </View>
            ) : null}
            <Text style={styles.facts}>{facts.join('  ·  ')}</Text>
          </Animated.View>
          <View style={styles.badgeRow}>
            <StatusBadge anime={a} />
            <LangBadges anime={a} size="md" />
            {a.contentRating ? (
              <View style={styles.age}>
                <Icon name="shield" size={13} color="#fff" />
                <Text style={styles.ageText}>{a.contentRating}</Text>
              </View>
            ) : null}
          </View>
          {a.genres?.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.genres}>
              {a.genres.map((g) => (
                <PressableScale key={g} onPress={() => router.push(`/browse?genre=${encodeURIComponent(g)}`)} style={styles.genre}>
                  <Text style={styles.genreText}>{g}</Text>
                </PressableScale>
              ))}
            </ScrollView>
          ) : null}

          <Actions anime={a} />
        </View>

        {a.nextEpisode ? <NextEpisode ep={a.nextEpisode.episode} at={a.nextEpisode.airingAt} /> : null}
      </Animated.ScrollView>

      {/* Floating bar: always shows back / save; turns solid with the title once you scroll */}
      <View style={[styles.topBar, { paddingTop: insets.top }]} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, barStyle]}>
          {Platform.OS === 'ios' ? <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} /> : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'ios' ? 'rgba(14,15,19,0.82)' : 'rgba(14,15,19,0.97)' }]} />
        </Animated.View>
        <View style={styles.topRow}>
          <RoundButton icon="left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <Animated.Text style={[styles.barTitle, barStyle]} numberOfLines={1}>
            {a.title}
          </Animated.Text>
          <SaveButton anime={a} />
        </View>
      </View>
    </View>
  );
}

// Airing / Finished / Upcoming, with a pulsing dot while a show is airing.
function StatusBadge({ anime }: { anime: AnimeDetail }) {
  // Series pages use the series-wide status (same source as the facts line),
  // so a finished Season 1 of a show that's still airing reads "Airing".
  const t = (anime.tmdbStatus || '').toLowerCase();
  const s = (anime.status || '').toLowerCase();
  const kind = t
    ? t === 'airing'
      ? 'airing'
      : t === 'planned' || t === 'in production'
        ? 'upcoming'
        : 'finished'
    : anime.airing || (s.includes('airing') && !s.includes('finished'))
      ? 'airing'
      : s.includes('not yet') || s.includes('upcoming')
        ? 'upcoming'
        : s
          ? 'finished'
          : null;
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (kind !== 'airing') return;
    pulse.value = withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1);
  }, [kind, pulse]);
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));
  if (!kind) return null;
  const look = {
    airing: { text: 'Airing', color: colors.green, bg: 'rgba(95,208,104,0.14)' },
    upcoming: { text: 'Upcoming', color: colors.sub, bg: 'rgba(167,167,255,0.14)' },
    finished: { text: 'Finished', color: colors.text2, bg: 'rgba(255,255,255,0.08)' },
  }[kind];
  return (
    <View style={[styles.status, { backgroundColor: look.bg }]}>
      <Animated.View style={[styles.statusDotBadge, { backgroundColor: look.color }, dot]} />
      <Text style={[styles.statusBadgeText, { color: look.color }]}>{look.text}</Text>
    </View>
  );
}

function RoundButton({ icon, label, onPress, color = '#fff' }: { icon: IconName; label: string; onPress: () => void; color?: string }) {
  return (
    <PressableScale onPress={onPress} style={styles.round} accessibilityLabel={label} hitSlop={8}>
      <Icon name={icon} size={22} color={color} />
    </PressableScale>
  );
}

function BackButton({ top }: { top: number }) {
  return (
    <View style={{ position: 'absolute', top: top + 6, left: 12, zIndex: 5 }}>
      <RoundButton icon="left" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </View>
  );
}

// Bookmark that pops when tapped.
function SaveButton({ anime }: { anime: AnimeDetail }) {
  const { inList, toggleList } = useLibrary();
  const saved = inList(anime.id);
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <RoundButton
        icon={saved ? 'bookmarkOn' : 'bookmark'}
        label={saved ? 'Remove from My List' : 'Add to My List'}
        color={saved ? colors.accent : '#fff'}
        onPress={() => {
          const added = toggleList(anime);
          haptic(added ? 'success' : 'warn');
          scale.value = withSequence(withSpring(1.3, springs.bouncy), withSpring(1, springs.press));
        }}
      />
    </Animated.View>
  );
}

function Actions({ anime }: { anime: AnimeDetail }) {
  const { inList, toggleList, progress } = useLibrary();
  const saved = inList(anime.id);
  const watchedEp = progress[anime.id]?.episode || 0;
  const nextEp = watchedEp > 0 ? watchedEp + 1 : 1;
  const watchLabel = watchedEp > 0 ? `Resume Ep ${nextEp}` : 'Watch Episode 1';

  return (
    <Animated.View entering={FadeInDown.delay(230).duration(450)} style={styles.actions}>
      <PressableScale
        haptic
        style={styles.primaryBtn}
        onPress={() => router.push(`/watch/${anime.id}?season=1&ep=${nextEp}` as any)}
      >
        <Icon name="play" size={18} color="#000" />
        <Text style={styles.primaryText} numberOfLines={1}>
          {watchLabel}
        </Text>
      </PressableScale>

      <View style={styles.secondaryRow}>
        {anime.trailer ? (
          <PressableScale haptic style={styles.secondaryBtn} onPress={() => openLink(`https://www.youtube.com/watch?v=${anime.trailer}`)}>
            <Icon name="spark" size={16} color="#fff" />
            <Text style={styles.secondaryText}>Trailer</Text>
          </PressableScale>
        ) : null}
        <PressableScale
          style={[styles.secondaryBtn, saved && styles.secondaryOn]}
          onPress={() => {
            const added = toggleList(anime);
            haptic(added ? 'success' : 'warn');
          }}
        >
          <Icon name={saved ? 'check' : 'plus'} size={16} color={saved ? colors.accent : '#fff'} />
          <Text style={[styles.secondaryText, saved && { color: colors.accent }]}>{saved ? 'In My List' : 'My List'}</Text>
        </PressableScale>
      </View>
    </Animated.View>
  );
}

// Next-episode card: live badge, rolling Days/Hrs/Min/Sec that tick every
// second, the exact air time, and how far through the week we are.
const WEEK = 7 * 86400;
function NextEpisode({ ep, at }: { ep: number; at: number }) {
  const reduce = useReducedMotion();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, at - now);
  const out = left === 0;
  const units = [
    { label: 'Days', value: Math.floor(left / 86400) },
    { label: 'Hrs', value: Math.floor((left % 86400) / 3600) },
    { label: 'Min', value: Math.floor((left % 3600) / 60) },
    { label: 'Sec', value: left % 60 },
  ];
  const when = new Date(at * 1000);
  const whenText =
    when.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) +
    '  ·  ' +
    when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Pulsing live dot and a light sweep across the progress bar.
  const pulse = useSharedValue(1);
  const sweep = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    pulse.value = withRepeat(withSequence(withTiming(2.2, { duration: 1100 }), withTiming(1, { duration: 0 })), -1);
    sweep.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1);
  }, [reduce, pulse, sweep]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: interpolate(pulse.value, [1, 2.2], [0.6, 0]) }));

  // How far we are from the last episode (weekly) to this one.
  const pct = out ? 1 : Math.min(1, Math.max(0.03, 1 - left / WEEK));
  const [barW, setBarW] = useState(0);
  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(pct, { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [pct, fill]);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (fill.value - 1) * barW }] }));
  const shine = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(sweep.value, [0, 1], [-80, barW]) }] }));

  return (
    <Animated.View entering={FadeInDown.delay(280).duration(450)} style={styles.next}>
      <LinearGradient colors={['rgba(255,100,10,0.22)', 'rgba(255,100,10,0.04)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.nextHead}>
        <View style={styles.liveDotWrap}>
          <Animated.View style={[styles.liveRing, ring]} />
          <View style={styles.liveDot} />
        </View>
        <Text style={styles.nextKicker}>{out ? 'OUT NOW' : 'NEXT EPISODE'}</Text>
        <View style={styles.epPill}>
          <Text style={styles.epPillText}>EP {ep}</Text>
        </View>
      </View>
      {out ? (
        <Text style={styles.outNow}>Episode {ep} is out</Text>
      ) : (
        <View style={styles.units}>
          {units.map((u, i) => (
            <View key={u.label} style={styles.unitWrap}>
              <View style={styles.unit}>
                <RollingNumber value={u.value} reduce={reduce} />
                <Text style={styles.unitLabel}>{u.label}</Text>
              </View>
              {i < units.length - 1 ? <Text style={styles.colon}>:</Text> : null}
            </View>
          ))}
        </View>
      )}
      <View style={styles.whenRow}>
        <Icon name="calendar" size={14} color={colors.text2} />
        <Text style={styles.whenText}>{whenText}</Text>
      </View>
      <View style={styles.weekBar} onLayout={(e) => setBarW(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.weekFill, fillStyle]}>
          {!reduce ? (
            <Animated.View style={[styles.shine, shine]}>
              <LinearGradient colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            </Animated.View>
          ) : null}
        </Animated.View>
      </View>
    </Animated.View>
  );
}

// Each new value slides up into place, like a flip clock. One text node that
// is always on screen; only a transform/opacity plays.
function RollingNumber({ value, reduce }: { value: number; reduce: boolean }) {
  const text = String(value).padStart(2, '0');
  const t = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current || reduce) {
      first.current = false;
      return;
    }
    t.value = 0;
    t.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [text, reduce, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + t.value * 0.75, transform: [{ translateY: (1 - t.value) * 16 }] }));
  return (
    <View style={styles.digitBox}>
      <Animated.Text style={[styles.digit, style]}>{text}</Animated.Text>
    </View>
  );
}

function DetailSkeleton({ heroH }: { heroH: number }) {
  return (
    <View style={styles.screen}>
      <Skeleton width="100%" height={heroH} rounded={0} />
      <View style={{ alignItems: 'center', marginTop: -120, gap: 12 }}>
        <Skeleton width={120} height={180} rounded={radius.md} />
        <Skeleton width={220} height={30} />
        <Skeleton width={180} height={14} />
        <Skeleton width={300} height={48} rounded={radius.md} style={{ marginTop: 10 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  head: { alignItems: 'center', paddingHorizontal: 20 },
  posterWrap: { borderRadius: radius.md, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
  poster: { width: 124, height: 186, backgroundColor: colors.surface2 },
  kicker: { marginTop: 16, color: colors.accent, fontFamily: fonts.black, fontSize: 11, letterSpacing: 4 },
  logo: { width: '80%', height: 86, marginTop: 8 },
  title: { marginTop: 6, color: '#fff', fontFamily: fonts.display, fontSize: 42, lineHeight: 44, textAlign: 'center' },
  alt: { marginTop: 4, color: colors.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' },
  factRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
  scoreChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  scoreText: { color: '#fff', fontFamily: fonts.black, fontSize: 14 },
  facts: { color: colors.text2, fontFamily: fonts.bold, fontSize: 13, textAlign: 'center' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  age: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 24, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  ageText: { color: '#fff', fontFamily: fonts.black, fontSize: 11.5 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingHorizontal: 10, borderRadius: 12 },
  statusDotBadge: { width: 7, height: 7, borderRadius: 4 },
  statusBadgeText: { fontFamily: fonts.black, fontSize: 11.5 },
  genres: { gap: 8, paddingVertical: 14, paddingHorizontal: 4 },
  genre: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.sm, paddingHorizontal: 12, height: 30, justifyContent: 'center' },
  genreText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  actions: { width: '100%', gap: 10, marginBottom: 22 },
  primaryBtn: { height: 50, borderRadius: radius.md, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  primaryText: { color: '#000', fontFamily: fonts.black, fontSize: 14.5, letterSpacing: 0.5, textTransform: 'uppercase' },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondaryBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.surface2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryOn: { backgroundColor: 'rgba(255,100,10,0.14)' },
  secondaryText: { color: '#fff', fontFamily: fonts.black, fontSize: 13, letterSpacing: 0.4, textTransform: 'uppercase' },
  next: { marginHorizontal: 16, marginBottom: 22, padding: 16, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(255,100,10,0.35)' },
  nextHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveDotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  liveRing: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  nextKicker: { flex: 1, color: colors.accent, fontFamily: fonts.black, fontSize: 11.5, letterSpacing: 2 },
  epPill: { paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: colors.accent, justifyContent: 'center' },
  epPillText: { color: '#000', fontFamily: fonts.black, fontSize: 12 },
  outNow: { color: '#fff', fontFamily: fonts.black, fontSize: 22, marginTop: 14 },
  units: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 14 },
  unitWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  unit: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  digitBox: { height: 34, alignSelf: 'stretch', overflow: 'hidden' },
  digit: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#fff', fontFamily: fonts.black, fontSize: 28, lineHeight: 34, fontVariant: ['tabular-nums'] },
  unitLabel: { color: colors.muted, fontFamily: fonts.black, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 2 },
  colon: { color: 'rgba(255,255,255,0.3)', fontFamily: fonts.black, fontSize: 22, lineHeight: 50, paddingHorizontal: 4 },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  whenText: { color: colors.text2, fontFamily: fonts.bold, fontSize: 13 },
  weekBar: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 12 },
  weekFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 3, backgroundColor: colors.accent, overflow: 'hidden' },
  shine: { position: 'absolute', top: 0, bottom: 0, width: 80 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topRow: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 12 },
  barTitle: { flex: 1, color: '#fff', fontFamily: fonts.black, fontSize: 16, textAlign: 'center' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
});
