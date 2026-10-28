import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LangBadges } from '@/components/Badges';
import { Icon, type IconName } from '@/components/Icon';
import { PosterCard } from '@/components/PosterCard';
import { PressableScale } from '@/components/PressableScale';
import { Row, SectionHeader } from '@/components/Row';
import { Skeleton } from '@/components/Skeleton';
import { ErrorState } from '@/components/States';
import { api } from '@/lib/api';
import { countdown, factsOf, fmtNum, primaryStream } from '@/lib/format';
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
  const extras = useFetch(() => api.extras(String(id)), [id]);
  const lib = useLibrary();

  useEffect(() => {
    if (a) lib.recordView(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id]);

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
  const watch = primaryStream(a.links?.length ? a.links : a.streaming);
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

          <Actions anime={a} watch={watch} />
        </View>

        {a.nextEpisode ? <NextEpisode ep={a.nextEpisode.episode} at={a.nextEpisode.airingAt} /> : null}
        <ProgressTracker anime={a} watch={watch} />
        <Synopsis text={a.synopsis} />
        <Ratings anime={a} />
        <Languages anime={a} />
        <Related anime={a} />
        <FanStats anime={a} />

        {extras.data?.characters?.length ? (
          <Animated.View entering={FadeIn.duration(350)} style={{ marginBottom: 28 }}>
            <SectionHeader title="Characters & Voice Cast" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 14 }}>
              {extras.data.characters.map((c, i) => (
                <Animated.View key={`${c.name}-${i}`} entering={FadeInDown.delay(Math.min(i, 8) * 40)} style={styles.char}>
                  {c.image ? <Image source={{ uri: c.image }} style={styles.charImg} contentFit="cover" transition={200} /> : <View style={styles.charImg} />}
                  <Text style={styles.charName} numberOfLines={2}>
                    {c.name}
                  </Text>
                  <Text style={styles.charRole} numberOfLines={1}>
                    {c.voiceActor || c.role}
                  </Text>
                </Animated.View>
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}
        <Row title="You might also like" items={extras.data?.recommendations} />
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

function Actions({ anime, watch }: { anime: AnimeDetail; watch: { name: string; url: string } | null }) {
  const { inList, toggleList } = useLibrary();
  const saved = inList(anime.id);
  return (
    <Animated.View entering={FadeInDown.delay(230).duration(450)} style={styles.actions}>
      {watch ? (
        <PressableScale haptic style={styles.primaryBtn} onPress={() => openLink(watch.url)}>
          <Icon name="play" size={18} color="#000" />
          <Text style={styles.primaryText} numberOfLines={1}>
            Watch on {watch.name}
          </Text>
        </PressableScale>
      ) : null}
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

function NextEpisode({ ep, at }: { ep: number; at: number }) {
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={styles.countdown}>
      <Icon name="clock" size={18} color={colors.accent} />
      <Text style={styles.countdownText}>
        Episode {ep} airs in <Text style={{ color: colors.accent, fontFamily: fonts.black }}>{countdown(at - now)}</Text>
      </Text>
    </View>
  );
}

// "Continue Watching" without a player: the viewer ticks off episodes as they
// watch them on the official platform, and the home screen picks it up.
function ProgressTracker({ anime, watch }: { anime: AnimeDetail; watch: { name: string; url: string } | null }) {
  const { progress, setProgress, clearProgress } = useLibrary();
  const total = anime.seasonCount && anime.episodeCount ? anime.episodeCount : anime.episodes ?? anime.episodeCount ?? null;
  const done = progress[anime.id]?.episode ?? 0;
  const finished = !!total && done >= total;
  const pct = total ? Math.min(1, done / total) : 0;
  const w = useSharedValue(pct);
  useEffect(() => {
    w.value = withSpring(pct, springs.soft);
  }, [pct, w]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, w.value)) * 100}%` }));

  const set = (n: number) => {
    const next = Math.max(0, total ? Math.min(total, n) : n);
    setProgress(anime, next, total, watch);
    haptic(next > done ? 'success' : 'tap');
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Icon name="history" size={18} color={colors.accent} />
        <Text style={styles.cardTitle}>Your progress</Text>
        {done > 0 ? (
          <PressableScale onPress={() => clearProgress(anime.id)} hitSlop={8}>
            <Text style={styles.reset}>Reset</Text>
          </PressableScale>
        ) : null}
      </View>
      <Text style={styles.progressText}>
        {finished ? 'Finished — nice!' : done ? `Watched ${done}${total ? ` of ${total}` : ''} episodes` : 'Not started yet'}
      </Text>
      {total ? (
        <View style={styles.track}>
          <Animated.View style={[styles.trackFill, fill]} />
        </View>
      ) : null}
      <View style={styles.stepper}>
        <PressableScale style={styles.stepBtn} onPress={() => set(done - 1)} disabled={done === 0} accessibilityLabel="One episode less">
          <Icon name="minus" size={18} color={done === 0 ? colors.surface3 : '#fff'} />
        </PressableScale>
        <PressableScale haptic style={[styles.markBtn, finished && { backgroundColor: colors.surface2 }]} onPress={() => set(done + 1)} disabled={finished}>
          <Icon name="check" size={16} color={finished ? colors.muted : '#000'} />
          <Text style={[styles.markText, finished && { color: colors.muted }]}>{finished ? 'All watched' : `Mark episode ${done + 1} watched`}</Text>
        </PressableScale>
        <PressableScale style={styles.stepBtn} onPress={() => set(done + 1)} disabled={finished} accessibilityLabel="One episode more">
          <Icon name="plus" size={18} color={finished ? colors.surface3 : '#fff'} />
        </PressableScale>
      </View>
    </View>
  );
}

function Synopsis({ text }: { text?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.synopsis} numberOfLines={open ? undefined : 4}>
        {text}
      </Text>
      {text.length > 220 ? (
        <PressableScale onPress={() => setOpen((o) => !o)} hitSlop={8}>
          <Text style={styles.more}>{open ? 'Show less' : 'Read more'}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function Ratings({ anime }: { anime: AnimeDetail }) {
  const boxes = [
    anime.score ? { label: `${anime.source === 'jikan' ? 'MAL' : 'AniList'} score`, value: `${anime.score.toFixed(1)}`, foot: '/ 10', star: true } : null,
    anime.rank ? { label: 'Ranked', value: `#${anime.rank.toLocaleString()}`, foot: 'all time' } : null,
    anime.members ? { label: 'Fans', value: fmtNum(anime.members), foot: 'tracking this' } : null,
    anime.seasonCount ? { label: 'Series', value: String(anime.seasonCount), foot: `${anime.seasonCount === 1 ? 'season' : 'seasons'}${anime.episodeCount ? ` · ${anime.episodeCount} eps` : ''}` } : null,
  ].filter(Boolean) as { label: string; value: string; foot: string; star?: boolean }[];
  if (!boxes.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, marginBottom: 26 }}>
      {boxes.map((b, i) => (
        <Animated.View key={b.label} entering={FadeInDown.delay(i * 60)} style={styles.rateBox}>
          <Text style={styles.rateLabel}>{b.label.toUpperCase()}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {b.star ? <Icon name="star" size={18} color={colors.star} /> : null}
            <Text style={styles.rateValue}>{b.value}</Text>
          </View>
          <Text style={styles.rateFoot}>{b.foot}</Text>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

// Only the languages that are actually available.
function Languages({ anime }: { anime: AnimeDetail }) {
  const l = anime.languages;
  const audio = l?.audio?.length ? l.audio : ['Japanese'];
  const subs = l?.subtitles?.length ? l.subtitles : ['English'];
  return (
    <View style={[styles.card, { gap: 14 }]}>
      <View>
        <Text style={styles.langHead}>AUDIO</Text>
        <View style={styles.langList}>
          {audio.map((lang) => (
            <View key={lang} style={styles.langChip}>
              <Icon name="mic" size={15} color={colors.dub} />
              <Text style={styles.langText}>{lang}</Text>
              {lang === 'English' && l?.dub === 'partial' ? <Text style={styles.langNote}>some episodes</Text> : null}
            </View>
          ))}
        </View>
      </View>
      <View>
        <Text style={styles.langHead}>SUBTITLES</Text>
        <View style={styles.langList}>
          {subs.map((lang) => (
            <View key={lang} style={styles.langChip}>
              <Icon name="cc" size={15} color={colors.dub} />
              <Text style={styles.langText}>{lang}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function Related({ anime }: { anime: AnimeDetail }) {
  const items = useMemo(
    () =>
      (anime.relations || [])
        // AniList can link the same title twice (e.g. as sequel and side story): show it once.
        .filter((r, i, all) => r.id && r.title && all.findIndex((x) => x.id === r.id) === i)
        .map((r) => ({ id: r.id as string, title: r.title, image: r.image, type: r.format, year: r.year, relation: r.relation })),
    [anime.relations]
  );
  if (!items.length) return null;
  return (
    <View style={{ marginBottom: 28 }}>
      <SectionHeader title="Related" sub="Seasons, films, spin-offs" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}>
        {items.map((r, i) => (
          <View key={r.id}>
            <PosterCard anime={r} index={i} width={112} />
            <Text style={styles.relTag}>{r.relation}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function FanStats({ anime }: { anime: AnimeDetail }) {
  const dist = (anime.scoreDistribution || []).filter((d) => d.amount);
  const status = anime.statusDistribution || [];
  if (!dist.length && !status.length) return null;
  const max = Math.max(...dist.map((d) => d.amount), 1);
  const total = dist.reduce((s, d) => s + d.amount, 0);
  const high = dist.filter((d) => d.score >= 80).reduce((s, d) => s + d.amount, 0);
  const statusTotal = status.reduce((s, d) => s + d.amount, 0) || 1;
  const statusColor: Record<string, string> = { Watching: colors.dub, 'Plan to watch': colors.sub, Completed: colors.green, Dropped: colors.danger, 'On hold': colors.star };
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>How fans rated it</Text>
      {total ? (
        <Text style={styles.statNote}>
          <Text style={{ color: colors.green, fontFamily: fonts.black }}>{Math.round((high / total) * 100)}%</Text> rated it 8 or higher · {fmtNum(total)} ratings
        </Text>
      ) : null}
      <View style={styles.dist}>
        {dist.map((d, i) => (
          <View key={d.score} style={styles.distCol}>
            <Animated.View
              entering={FadeInDown.delay(i * 40).duration(400)}
              style={[styles.distBar, { height: `${Math.max(4, (d.amount / max) * 100)}%`, backgroundColor: `hsl(${Math.round((d.score / 100) * 120)}, 75%, 52%)` }]}
            />
            <Text style={styles.distLabel}>{d.score / 10}</Text>
          </View>
        ))}
      </View>
      {status.length ? (
        <View style={{ marginTop: 16, gap: 6 }}>
          {status.map((s) => (
            <View key={s.status} style={styles.statusRow}>
              <View style={[styles.statusDot, { backgroundColor: statusColor[s.status] || colors.muted }]} />
              <Text style={styles.statusName}>{s.status}</Text>
              <Text style={styles.statusVal}>{fmtNum(s.amount)}</Text>
              <Text style={styles.statusPct}>{Math.round((s.amount / statusTotal) * 100)}%</Text>
            </View>
          ))}
        </View>
      ) : null}
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
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 16, padding: 14, borderRadius: radius.md, backgroundColor: 'rgba(255,100,10,0.1)', borderWidth: 1, borderColor: 'rgba(255,100,10,0.35)' },
  countdownText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  card: { marginHorizontal: 16, marginBottom: 22, padding: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, color: '#fff', fontFamily: fonts.black, fontSize: 16 },
  reset: { color: colors.muted, fontFamily: fonts.black, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  progressText: { color: colors.text2, fontFamily: fonts.regular, fontSize: 13.5, marginTop: 8 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: 'hidden', marginTop: 12 },
  trackFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  stepBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  markBtn: { flex: 1, height: 44, borderRadius: radius.md, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10 },
  markText: { color: '#000', fontFamily: fonts.black, fontSize: 13 },
  section: { paddingHorizontal: 16, marginBottom: 22 },
  synopsis: { color: '#e4e4e4', fontFamily: fonts.regular, fontSize: 15, lineHeight: 23 },
  more: { color: colors.accent, fontFamily: fonts.black, fontSize: 12.5, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 8 },
  rateBox: { minWidth: 118, padding: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  rateLabel: { color: colors.muted, fontFamily: fonts.black, fontSize: 10.5, letterSpacing: 1 },
  rateValue: { color: '#fff', fontFamily: fonts.black, fontSize: 24, marginTop: 4 },
  rateFoot: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11.5, marginTop: 2 },
  langHead: { color: colors.muted, fontFamily: fonts.black, fontSize: 11, letterSpacing: 1.4, marginBottom: 10 },
  langList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.surface2 },
  langText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  langNote: { color: colors.star, fontFamily: fonts.bold, fontSize: 11.5 },
  relTag: { position: 'absolute', top: 7, left: 7, color: '#fff', backgroundColor: 'rgba(0,0,0,0.75)', fontFamily: fonts.black, fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  statNote: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 6 },
  dist: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 120, marginTop: 14 },
  distCol: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 5 },
  distBar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  distLabel: { color: colors.muted, fontFamily: fonts.bold, fontSize: 10.5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 9, height: 9, borderRadius: 3 },
  statusName: { flex: 1, color: colors.text2, fontFamily: fonts.regular, fontSize: 13.5 },
  statusVal: { color: '#fff', fontFamily: fonts.bold, fontSize: 13.5 },
  statusPct: { width: 40, textAlign: 'right', color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5 },
  char: { width: 92, alignItems: 'center' },
  charImg: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surface2 },
  charName: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5, textAlign: 'center', marginTop: 8 },
  charRole: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11, textAlign: 'center', marginTop: 2 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topRow: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 12 },
  barTitle: { flex: 1, color: '#fff', fontFamily: fonts.black, fontSize: 16, textAlign: 'center' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
});
