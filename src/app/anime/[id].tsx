import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { memo, useEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Share, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
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
import { BottomSheet } from '@/components/BottomSheet';
import { Icon, type IconName } from '@/components/Icon';
import { PosterCard } from '@/components/PosterCard';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { ErrorState } from '@/components/States';
import { posterOf, useArt } from '@/lib/artwork';
import { fmtNum } from '@/lib/format';
import { useLibrary } from '@/lib/library';
import { useDetail, useEpisodes, useExtras } from '@/lib/queries';
import { displayTitle, useSettings } from '@/lib/settings';
import { colors, fonts, radius, springs } from '@/lib/theme';
import type { AnimeDetail, Episode } from '@/lib/types';

const haptic = (kind: 'tap' | 'success' | 'warn' = 'tap') => {
  if (Platform.OS === 'web') return;
  if (kind === 'tap') Haptics.selectionAsync().catch(() => {});
  else Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
};

const openLink = (url: string) => {
  if (Platform.OS === 'web') Linking.openURL(url);
  else WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
};

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
const BOTTOM_BAR = 76;

type Tab = 'episodes' | 'more';

export default function DetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const heroH = Math.round(width * 1.25);
  const reduce = useReducedMotion();

  // Saved page (instant), or the tapped card while the full page loads.
  const detail = useDetail(String(id));
  const a = detail.data ?? null;
  const loading = detail.isPending;
  const error = detail.error ? detail.error.message || 'Something went wrong' : null;

  const [season, setSeason] = useState(1);
  const eps = useEpisodes(String(id), season, !!a?.airing);
  const { data: extras } = useExtras(String(id));
  const { art: tmdb, settled: artSettled, known: artKnown } = useArt(a, true);
  const { titleLang } = useSettings();

  // Fixed when the page opens: the poster the card already showed (instant,
  // from cache) is the first layer of the key art.
  const opened = useRef<{ id: string; poster?: string; logoKnown: boolean } | null>(null);
  if (a && opened.current?.id !== a.id) opened.current = { id: a.id, poster: posterOf(a, tmdb), logoKnown: artKnown };

  const [tab, setTab] = useState<Tab>('episodes');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [seasonOpen, setSeasonOpen] = useState(false);

  // ---- Motion ----
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  // Key art settles in (slow zoom-out), moves at half speed while scrolling,
  // stretches when pulled down.
  const settle = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) settle.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) });
  }, [reduce, settle]);
  const artStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    return {
      transform: [
        { translateY: y > 0 ? y * 0.5 : y / 2 },
        { scale: (y < 0 ? 1 + -y / heroH : 1) * interpolate(settle.value, [0, 1], [1.08, 1]) },
      ],
    };
  });
  const barStyle = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [heroH - 200, heroH - 120], [0, 1], Extrapolation.CLAMP) }));

  if (loading && !a) return <DetailSkeleton heroH={heroH} />;
  if (error && !a) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 60 }]}>
        <View style={{ position: 'absolute', top: insets.top + 6, left: 12, zIndex: 5 }}>
          <RoundButton icon="x" label="Close" onPress={goBack} />
        </View>
        <ErrorState message={error} onRetry={() => detail.refetch()} />
      </View>
    );
  }
  if (!a) return null;

  const name = displayTitle(a, titleLang);
  const cardPoster = opened.current?.poster;
  // Tall key art: the TMDB poster at a size fit for the full screen width.
  const keyArt = artSettled && tmdb?.poster ? tmdb.poster.replace('/w342/', '/w780/') : undefined;
  // Title logo: shown if known when the page opened, or as soon as the lookup
  // lands (its space is reserved, so nothing shifts). Otherwise a display-font title.
  const logo = tmdb?.logo || null;
  const showLogoArea = !artSettled && !opened.current?.logoKnown;
  const meta = [a.year ? String(a.year) : '', a.type || '', ...(a.genres || []).slice(0, 3)].filter(Boolean);
  const episodes = eps.data?.episodes || [];
  const seasons = eps.data?.seasons || [];
  const seasonName = seasons.find((s) => s.season_number === season)?.name || `Season ${season}`;
  const recs = extras?.recommendations || [];
  const cols = width >= 700 ? 5 : 3;
  const recW = Math.floor((width - 32 - (cols - 1) * 12) / cols);
  const enter = (delay: number) => (reduce ? undefined : FadeInDown.delay(delay).duration(380));

  return (
    <View style={styles.screen}>
      <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: insets.bottom + BOTTOM_BAR + 24 }}>
        {/* Key art with the title logo over its bottom */}
        <View style={{ height: heroH, overflow: 'hidden' }}>
          <Animated.View style={[StyleSheet.absoluteFill, artStyle]}>
            {cardPoster ? <Image source={{ uri: cardPoster }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" cachePolicy="memory-disk" /> : null}
            {keyArt ? <Image source={{ uri: keyArt }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={300} cachePolicy="memory-disk" /> : null}
          </Animated.View>
          <LinearGradient colors={['rgba(0,0,0,0.5)', 'transparent', 'rgba(0,0,0,0.55)', colors.bg]} locations={[0, 0.22, 0.68, 1]} style={StyleSheet.absoluteFill} />
          <View style={styles.titleArea}>
            {logo ? (
              <Animated.View entering={reduce ? undefined : FadeIn.duration(350)} style={{ width: '100%', alignItems: 'center' }}>
                <Image source={{ uri: logo }} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" accessibilityLabel={name} />
              </Animated.View>
            ) : showLogoArea ? null : (
              <Animated.Text entering={reduce ? undefined : FadeIn.duration(300)} style={styles.titleText} numberOfLines={3} adjustsFontSizeToFit>
                {name}
              </Animated.Text>
            )}
          </View>
        </View>

        {/* Centred info, like the Crunchyroll app */}
        <View style={styles.info}>
          <Animated.View entering={enter(0)} style={styles.metaRow}>
            {a.contentRating ? (
              <View style={styles.rating}>
                <Text style={styles.ratingText}>{a.contentRating}</Text>
              </View>
            ) : null}
            <Text style={styles.meta} numberOfLines={2}>
              {a.contentRating ? '  •  ' : ''}
              {meta.join('  •  ')}
            </Text>
          </Animated.View>

          {a.score ? (
            <Animated.View entering={enter(50)} style={styles.starsRow}>
              <Stars value={a.score / 2} />
              <Text style={styles.avg}>
                Average: <Text style={styles.avgNum}>{(a.score / 2).toFixed(1)}</Text>
                {a.members ? <Text style={styles.avgCount}> ({fmtNum(a.members)})</Text> : null}
              </Text>
            </Animated.View>
          ) : null}

          <Animated.View entering={enter(100)}>
            <ActionIcons anime={a} name={name} />
          </Animated.View>

          {a.nextEpisode ? <NextUp ep={a.nextEpisode.episode} at={a.nextEpisode.airingAt} /> : null}

          {a.synopsis ? (
            <Animated.View entering={enter(150)} style={{ alignItems: 'center' }}>
              <Text style={styles.synopsis} numberOfLines={3}>
                {a.synopsis}
              </Text>
              <PressableScale onPress={() => setDetailsOpen(true)} hitSlop={10}>
                <Text style={styles.moreDetails}>More Details</Text>
              </PressableScale>
            </Animated.View>
          ) : null}
        </View>

        {/* Episodes | More Like This */}
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'episodes', label: a.type === 'Movie' ? 'Movie' : 'Episodes' },
            ...(recs.length ? [{ key: 'more' as Tab, label: 'More Like This' }] : []),
          ]}
        />

        {tab === 'episodes' ? (
          <Animated.View key="episodes" entering={FadeIn.duration(220)}>
            <PressableScale haptic disabled={seasons.length < 2} onPress={() => setSeasonOpen(true)} style={styles.seasonRow} scaleTo={0.99}>
              {seasons.length > 1 ? <Icon name="down" size={16} color="#fff" /> : null}
              <Text style={styles.seasonText} numberOfLines={1}>
                {seasonName}
              </Text>
              {episodes.length ? <Text style={styles.seasonCount}>{episodes.length} episodes</Text> : null}
            </PressableScale>

            <View style={styles.epList}>
              {episodes.length ? (
                episodes.map((ep, i) => (
                  <EpisodeRow key={`${season}-${ep.episode_number}`} ep={ep} index={i} animeId={a.id} season={season} fallback={cardPoster} thumbW={Math.round((width - 32) * 0.46)} reduce={reduce} />
                ))
              ) : eps.isPending || eps.isFetching ? (
                <EpisodeSkeleton thumbW={Math.round((width - 32) * 0.46)} />
              ) : (
                <Text style={styles.empty}>Episodes aren't listed for this season yet.</Text>
              )}
            </View>
          </Animated.View>
        ) : (
          <Animated.View key="more" entering={FadeIn.duration(220)} style={styles.grid}>
            {recs.map((r, i) => (
              <PosterCard key={r.id} anime={r} index={i} width={recW} />
            ))}
          </Animated.View>
        )}
      </Animated.ScrollView>

      {/* Top bar: close; the title slides in next to it once you scroll */}
      <View style={[styles.topBar, { paddingTop: insets.top }]} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, barStyle]}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' }]} />
        </Animated.View>
        <View style={styles.topRow}>
          <RoundButton icon="x" label="Close" onPress={goBack} />
          <Animated.Text style={[styles.barTitle, barStyle]} numberOfLines={1}>
            {name}
          </Animated.Text>
        </View>
      </View>

      {/* Sticky bottom: continue / start, and the watchlist */}
      <BottomBar anime={a} season={season} bottom={insets.bottom} />

      {/* More details */}
      <BottomSheet visible={detailsOpen} onClose={() => setDetailsOpen(false)} title={name} subtitle={meta.join(' · ')}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 10, gap: 18 }}>
          {a.synopsis ? <Text style={styles.sheetSynopsis}>{a.synopsis}</Text> : null}
          <View style={{ gap: 12 }}>
            <InfoLine label="Status" value={a.airing ? 'Airing' : a.status || ''} />
            <InfoLine label="Studio" value={a.studios?.join(', ')} />
            <InfoLine label="Aired" value={a.aired || (a.year ? String(a.year) : '')} />
            <InfoLine label="Episodes" value={a.episodes ? `${a.episodes}${a.duration ? ` · ${a.duration}` : ''}` : ''} />
            <InfoLine label="Original title" value={a.titleJapanese || a.titleRomaji || ''} />
          </View>
          {a.genres?.length ? (
            <View style={styles.sheetGenres}>
              {a.genres.map((g) => (
                <PressableScale
                  key={g}
                  onPress={() => {
                    setDetailsOpen(false);
                    router.push(`/browse?genre=${encodeURIComponent(g)}`);
                  }}
                  style={styles.genreChip}
                >
                  <Text style={styles.genreChipText}>{g}</Text>
                </PressableScale>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </BottomSheet>

      {/* Season picker */}
      <BottomSheet visible={seasonOpen} onClose={() => setSeasonOpen(false)} title="Seasons">
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 6 }}>
          {seasons.map((s) => {
            const on = s.season_number === season;
            return (
              <PressableScale
                key={s.season_number}
                haptic
                onPress={() => {
                  setSeason(s.season_number);
                  setSeasonOpen(false);
                }}
                style={[styles.seasonPick, on && styles.seasonPickOn]}
                scaleTo={0.98}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.seasonPickText, on && { color: colors.accent }]}>{s.name || `Season ${s.season_number}`}</Text>
                  {s.episode_count ? <Text style={styles.seasonPickSub}>{s.episode_count} episodes</Text> : null}
                </View>
                {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
              </PressableScale>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

// Five stars, filled to the score (out of 5), including a partly filled one.
function Stars({ value }: { value: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <View key={i} style={{ width: 18, height: 18 }}>
            <Icon name="star" size={18} color="rgba(255,255,255,0.25)" />
            <View style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 18 * fill, overflow: 'hidden' }}>
              <Icon name="star" size={18} color="#fff" />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// My List · Share · Trailer: orange icons with labels, centred.
function ActionIcons({ anime, name }: { anime: AnimeDetail; name: string }) {
  const { inList, toggleList } = useLibrary();
  const saved = inList(anime.id);
  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <View style={styles.iconActions}>
      <PressableScale
        style={styles.iconAction}
        onPress={() => {
          const added = toggleList(anime);
          haptic(added ? 'success' : 'warn');
          pop.value = withSequence(withSpring(1.3, springs.bouncy), withSpring(1, springs.press));
        }}
        accessibilityLabel={saved ? 'Remove from My List' : 'Add to My List'}
      >
        <Animated.View style={popStyle}>
          <Icon name={saved ? 'check' : 'plus'} size={26} color={colors.accent} />
        </Animated.View>
        <Text style={styles.iconActionText}>{saved ? 'In My List' : 'My List'}</Text>
      </PressableScale>
      <PressableScale
        style={styles.iconAction}
        onPress={() => {
          haptic();
          Share.share({ message: `${name} on AnimeVerse${anime.anilistUrl ? `\n${anime.anilistUrl}` : ''}` }).catch(() => {});
        }}
        accessibilityLabel="Share"
      >
        <Icon name="share" size={26} color={colors.accent} />
        <Text style={styles.iconActionText}>Share</Text>
      </PressableScale>
      {anime.trailer ? (
        <PressableScale style={styles.iconAction} onPress={() => openLink(`https://www.youtube.com/watch?v=${anime.trailer}`)} accessibilityLabel="Watch trailer">
          <Icon name="play" size={26} color={colors.accent} />
          <Text style={styles.iconActionText}>Trailer</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

// Sticky bar at the bottom of the screen.
function BottomBar({ anime, season, bottom }: { anime: AnimeDetail; season: number; bottom: number }) {
  const { inList, toggleList, progress } = useLibrary();
  const saved = inList(anime.id);
  const watchedEp = progress[anime.id]?.episode || 0;
  const nextEp = watchedEp > 0 ? watchedEp + 1 : 1;
  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <View style={[styles.bottomBar, { paddingBottom: bottom + 10 }]} pointerEvents="box-none">
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.92)', '#000']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <PressableScale haptic style={styles.primaryBtn} scaleTo={0.97} onPress={() => router.push(`/watch/${anime.id}?season=${season}&ep=${nextEp}` as any)}>
        <Icon name="play" size={20} color="#000" />
        <Text style={styles.primaryText} numberOfLines={1}>
          {watchedEp > 0 ? `Continue E${nextEp}` : 'Start Watching E1'}
        </Text>
      </PressableScale>
      <Animated.View style={popStyle}>
        <PressableScale
          style={[styles.roundSave, saved && styles.roundSaveOn]}
          onPress={() => {
            const added = toggleList(anime);
            haptic(added ? 'success' : 'warn');
            pop.value = withSequence(withSpring(1.18, springs.bouncy), withSpring(1, springs.press));
          }}
          accessibilityLabel={saved ? 'Remove from My List' : 'Add to My List'}
        >
          <Icon name={saved ? 'bookmarkOn' : 'bookmark'} size={22} color={colors.accent} />
        </PressableScale>
      </Animated.View>
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// Tabs with an underline that slides between them.
function Tabs({ value, tabs, onChange }: { value: Tab; tabs: { key: Tab; label: string }[]; onChange: (t: Tab) => void }) {
  const [layouts, setLayouts] = useState<Record<string, { x: number; w: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  useEffect(() => {
    const l = layouts[value];
    if (!l) return;
    const first = w.value === 0;
    const ease = { duration: 240, easing: Easing.bezier(0.2, 0.9, 0.25, 1) };
    x.value = first ? l.x : withTiming(l.x, ease);
    w.value = first ? l.w : withTiming(l.w, ease);
  }, [value, layouts, x, w]);
  const line = useAnimatedStyle(() => ({ width: w.value, transform: [{ translateX: x.value }] }));
  return (
    <View style={styles.tabs}>
      {tabs.map((t) => (
        <PressableScale
          key={t.key}
          haptic
          onPress={() => onChange(t.key)}
          scaleTo={0.97}
          onLayout={(e: LayoutChangeEvent) => {
            const { x: lx, width: lw } = e.nativeEvent.layout;
            setLayouts((p) => (p[t.key]?.x === lx && p[t.key]?.w === lw ? p : { ...p, [t.key]: { x: lx, w: lw } }));
          }}
          style={styles.tab}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === t.key }}
        >
          <Text style={[styles.tabText, value === t.key && styles.tabTextOn]}>{t.label}</Text>
        </PressableScale>
      ))}
      <Animated.View style={[styles.tabLine, line]} />
    </View>
  );
}

const EpisodeRow = memo(function EpisodeRow({
  ep,
  index,
  animeId,
  season,
  fallback,
  thumbW,
  reduce,
}: {
  ep: Episode;
  index: number;
  animeId: string;
  season: number;
  fallback?: string;
  thumbW: number;
  reduce: boolean;
}) {
  const thumb = ep.still_path || fallback;
  const date = ep.air_date ? new Date(ep.air_date) : null;
  const upcoming = !!date && date.getTime() > Date.now();
  return (
    <Animated.View entering={reduce || index > 7 ? undefined : FadeInDown.delay(index * 45).duration(320)}>
      <PressableScale
        onPress={() => router.push(`/watch/${animeId}?season=${season}&ep=${ep.episode_number}` as any)}
        style={styles.epRow}
        scaleTo={0.98}
        accessibilityLabel={`Episode ${ep.episode_number}${ep.name ? `, ${ep.name}` : ''}`}
      >
        <View style={[styles.epThumb, { width: thumbW, height: Math.round(thumbW * 0.5625) }]}>
          {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" /> : null}
          <View style={styles.epPlay}>
            <Icon name="play" size={16} color="#fff" />
          </View>
          {ep.runtime ? (
            <View style={styles.epDuration}>
              <Text style={styles.epDurationText}>{ep.runtime}m</Text>
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, paddingTop: 2 }}>
          <Text style={styles.epTitle} numberOfLines={3}>
            {ep.episode_number}. {ep.name || `Episode ${ep.episode_number}`}
          </Text>
          {date ? (
            <Text style={[styles.epMeta, upcoming && { color: colors.accent }]}>
              {upcoming ? 'Coming ' : ''}
              {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          ) : null}
        </View>
      </PressableScale>
    </Animated.View>
  );
});

function EpisodeSkeleton({ thumbW }: { thumbW: number }) {
  return (
    <View style={{ gap: 14 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
          <Skeleton width={thumbW} height={Math.round(thumbW * 0.5625)} rounded={radius.sm} />
          <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
            <Skeleton width="85%" height={14} />
            <Skeleton width="45%" height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

// "Next episode" line with a live countdown and a pulsing dot.
function NextUp({ ep, at }: { ep: number; at: number }) {
  const reduce = useReducedMotion();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, at - now);
  const d = Math.floor(left / 86400);
  const hms = [Math.floor((left % 86400) / 3600), Math.floor((left % 3600) / 60), left % 60].map((n) => String(n).padStart(2, '0')).join(':');

  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!reduce) pulse.value = withRepeat(withSequence(withTiming(2.2, { duration: 1100 }), withTiming(1, { duration: 0 })), -1);
  }, [reduce, pulse]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: interpolate(pulse.value, [1, 2.2], [0.6, 0]) }));

  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.delay(130).duration(380)} style={styles.nextUp}>
      <View style={styles.dotWrap}>
        <Animated.View style={[styles.dotRing, ring]} />
        <View style={styles.dot} />
      </View>
      <Text style={styles.nextUpText}>
        <Text style={{ color: colors.accent, fontFamily: fonts.black }}>EP {ep}</Text>
        {left === 0 ? '  ·  Out now' : `  ·  in ${d ? `${d}d ` : ''}`}
        {left === 0 ? null : <Text style={styles.nextUpClock}>{hms}</Text>}
      </Text>
    </Animated.View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.round} accessibilityLabel={label} hitSlop={8}>
      <Icon name={icon} size={22} color="#fff" />
    </PressableScale>
  );
}

function DetailSkeleton({ heroH }: { heroH: number }) {
  return (
    <View style={styles.screen}>
      <Skeleton width="100%" height={heroH} rounded={0} />
      <View style={{ padding: 16, gap: 12, alignItems: 'center' }}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="50%" height={18} />
        <Skeleton width="90%" height={13} />
        <Skeleton width="80%" height={13} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  titleArea: { position: 'absolute', left: 24, right: 24, bottom: 18, minHeight: 96, alignItems: 'center', justifyContent: 'flex-end' },
  logo: { width: '86%', height: 96 },
  titleText: { color: '#fff', fontFamily: fonts.display, fontSize: 34, lineHeight: 38, textAlign: 'center', letterSpacing: -1, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 2 } },
  info: { paddingHorizontal: 20, gap: 16, alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
  rating: { paddingHorizontal: 5, height: 18, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center' },
  ratingText: { color: '#fff', fontFamily: fonts.bold, fontSize: 10 },
  meta: { color: colors.text2, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center' },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avg: { color: colors.text2, fontFamily: fonts.regular, fontSize: 15 },
  avgNum: { color: '#fff', fontFamily: fonts.black },
  avgCount: { color: colors.text2 },
  iconActions: { flexDirection: 'row', justifyContent: 'center', gap: 36, paddingVertical: 4 },
  iconAction: { alignItems: 'center', gap: 6, minWidth: 64 },
  iconActionText: { color: colors.accent, fontFamily: fonts.bold, fontSize: 13 },
  nextUp: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,100,10,0.1)', borderWidth: 1, borderColor: 'rgba(255,100,10,0.28)' },
  dotWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  dotRing: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  nextUpText: { color: '#fff', fontFamily: fonts.bold, fontSize: 13.5 },
  nextUpClock: { fontFamily: fonts.black, fontVariant: ['tabular-nums'] },
  synopsis: { color: '#e6e6e6', fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 24, textAlign: 'center' },
  moreDetails: { color: colors.accent, fontFamily: fonts.black, fontSize: 15, marginTop: 14 },
  tabs: { flexDirection: 'row', gap: 28, paddingHorizontal: 16, marginTop: 30, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' },
  tab: { paddingVertical: 14 },
  tabText: { color: colors.muted, fontFamily: fonts.black, fontSize: 15 },
  tabTextOn: { color: '#fff' },
  tabLine: { position: 'absolute', left: 0, bottom: -1, height: 3, backgroundColor: colors.accent },
  seasonRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' },
  seasonText: { flex: 1, color: '#fff', fontFamily: fonts.black, fontSize: 18 },
  seasonCount: { color: colors.muted, fontFamily: fonts.bold, fontSize: 12.5 },
  epList: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  epRow: { flexDirection: 'row', gap: 14 },
  epThumb: { borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface2 },
  epPlay: { position: 'absolute', top: '50%', left: '50%', marginTop: -18, marginLeft: -18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  epDuration: { position: 'absolute', right: 5, bottom: 5, paddingHorizontal: 6, height: 19, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center' },
  epDurationText: { color: '#fff', fontFamily: fonts.regular, fontSize: 12 },
  epTitle: { color: '#fff', fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 21 },
  epMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 6 },
  empty: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 18, paddingHorizontal: 16, paddingTop: 18 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topRow: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 10 },
  barTitle: { flex: 1, color: '#fff', fontFamily: fonts.black, fontSize: 20 },
  round: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 22 },
  primaryBtn: { flex: 1, height: 52, borderRadius: 26, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 18 },
  primaryText: { color: '#000', fontFamily: fonts.black, fontSize: 17 },
  roundSave: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  roundSaveOn: { backgroundColor: 'rgba(255,100,10,0.14)' },
  sheetSynopsis: { color: colors.text2, fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 22 },
  infoLine: { flexDirection: 'row', gap: 12 },
  infoLabel: { width: 110, color: colors.muted, fontFamily: fonts.bold, fontSize: 13.5 },
  infoValue: { flex: 1, color: '#fff', fontFamily: fonts.regular, fontSize: 13.5 },
  sheetGenres: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  genreChip: { paddingHorizontal: 12, height: 32, borderRadius: radius.pill, backgroundColor: colors.surface2, justifyContent: 'center' },
  genreChipText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  seasonPick: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 14, borderRadius: radius.md },
  seasonPickOn: { backgroundColor: 'rgba(255,100,10,0.08)' },
  seasonPickText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  seasonPickSub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
});
