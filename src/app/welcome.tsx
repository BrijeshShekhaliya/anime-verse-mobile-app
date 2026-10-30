// First-launch welcome tour: five swipeable pages that show what the app does,
// each with a small animated scene built from real posters.
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/BottomSheet';
import { Brand } from '@/components/Brand';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { markOnboarded } from '@/lib/onboarding';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useHome } from '@/lib/queries';
import { rankByQuery } from '@/lib/searchRank';
import { colors, fonts, radius, springs } from '@/lib/theme';
import type { Anime } from '@/lib/types';

type Page = { key: string; title: string; text: string; scene: (p: SceneProps) => ReactNode };
type SceneProps = { posters: (string | undefined)[]; items: Anime[]; results: Anime[]; active: boolean; width: number; reduce: boolean };

const PAGES: Page[] = [
  {
    key: 'welcome',
    title: 'Welcome to AnimeVerse',
    text: 'Every anime in one place: what’s airing, what’s trending and what to watch next.',
    scene: (p) => <PosterWall {...p} />,
  },
  {
    key: 'discover',
    title: 'Discover what’s hot',
    text: 'Top 10 airing right now, this season’s line-up and the highest rated of all time, fresh every day.',
    scene: (p) => <TopTen {...p} />,
  },
  {
    key: 'search',
    title: 'Find any anime fast',
    text: 'Search by English or Japanese title, then filter by genre, status or format.',
    scene: (p) => <SearchDemo {...p} />,
  },
  {
    key: 'schedule',
    title: 'Never miss an episode',
    text: 'The release schedule shows every new episode this week, with live countdowns in your local time.',
    scene: (p) => <ScheduleDemo {...p} />,
  },
  {
    key: 'yours',
    title: 'Make it yours',
    text: 'Save shows to My List and pick up right where you left off.',
    scene: (p) => <ListDemo {...p} />,
  },
];

export default function WelcomeScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const { data } = useHome(); // also warms Home for when the tour ends

  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...(data?.trending || []), ...(data?.popular || []), ...(data?.topRated || [])].filter((a) => a.image && !seen.has(a.id) && seen.add(a.id));
  }, [data]);
  const posters = useMemo(() => {
    const list = items.map((a) => a.image2x || a.image || undefined);
    return list.length ? list : Array.from({ length: 18 }, () => undefined);
  }, [items]);

  // The search page shows the real results for what it types.
  const search = useQuery({
    queryKey: ['welcome-search', QUERY],
    queryFn: () => api.search({ q: QUERY }),
    staleTime: 24 * 60 * 60 * 1000,
  });
  const results = useMemo(() => rankByQuery(search.data?.items || [], QUERY), [search.data]);
  const [termsOpen, setTermsOpen] = useState(false);

  const [page, setPage] = useState(0);
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });
  const scrollRef = useRef<Animated.ScrollView>(null);
  const last = page === PAGES.length - 1;

  const finish = () => {
    markOnboarded();
    router.replace('/');
  };
  const next = () => {
    if (last) return finish();
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });
  };
  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  const sceneH = Math.min(height * 0.52, 470);

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onEnd}
        bounces={false}
      >
        {PAGES.map((p, i) => (
          <View key={p.key} style={{ width, paddingTop: insets.top }}>
            <View style={{ height: i === PAGES.length - 1 ? sceneH * 0.82 : sceneH, overflow: 'hidden' }}>{p.scene({ posters, items, results, active: page === i, width, reduce })}</View>
            <PageText index={i} scrollX={scrollX} width={width} title={p.title} text={p.text}>
              {i === PAGES.length - 1 ? <TermsNotice onRead={() => setTermsOpen(true)} /> : null}
            </PageText>
          </View>
        ))}
      </Animated.ScrollView>

      {/* Skip */}
      {!last ? (
        <PressableScale onPress={finish} style={[styles.skip, { top: insets.top + 10 }]} hitSlop={10} accessibilityLabel="Skip the tour">
          <Text style={styles.skipText}>Skip</Text>
        </PressableScale>
      ) : null}

      <TermsSheet visible={termsOpen} onClose={() => setTermsOpen(false)} />

      {/* Dots + Next / Get Started */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
        <View style={styles.dots}>
          {PAGES.map((p, i) => (
            <Dot key={p.key} index={i} scrollX={scrollX} width={width} />
          ))}
        </View>
        <PressableScale haptic onPress={next} style={[styles.cta, last && styles.ctaWide]} scaleTo={0.96} accessibilityLabel={last ? 'Get started' : 'Next page'}>
          <Text style={styles.ctaText}>{last ? 'Get Started' : 'Next'}</Text>
          <Icon name="right" size={18} color="#000" />
        </PressableScale>
      </View>
    </View>
  );
}

// Title and text slide and fade with the swipe.
function PageText({ index, scrollX, width, title, text, children }: { index: number; scrollX: SharedValue<number>; width: number; title: string; text: string; children?: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const p = (scrollX.value - index * width) / width;
    return { opacity: interpolate(p, [-0.6, 0, 0.6], [0, 1, 0], 'clamp'), transform: [{ translateX: interpolate(p, [-1, 0, 1], [60, 0, -60]) }] };
  });
  return (
    <Animated.View style={[styles.textBlock, style]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.text}>{text}</Text>
      {children}
    </Animated.View>
  );
}

function Dot({ index, scrollX, width }: { index: number; scrollX: SharedValue<number>; width: number }) {
  const style = useAnimatedStyle(() => {
    const d = Math.abs(scrollX.value / width - index);
    return { width: interpolate(d, [0, 1], [24, 8], 'clamp'), opacity: interpolate(d, [0, 1], [1, 0.35], 'clamp') };
  });
  return <Animated.View style={[styles.dot, style]} />;
}

// ---------- Scenes ----------

const Poster = ({ uri, w, style }: { uri?: string; w: number; style?: object }) => (
  <View style={[{ width: w, height: w * 1.5, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2 }, style]}>
    {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} cachePolicy="memory-disk" /> : null}
  </View>
);

const bottomEdge = (
  <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.85)']} locations={[0.62, 1]} style={StyleSheet.absoluteFill} />
);

// True from the first time a page is shown, and stays true: scene intros
// play once, so swiping away and back never shows them resetting.
function useStarted(active: boolean) {
  const [started, setStarted] = useState(active);
  useEffect(() => {
    if (active) setStarted(true);
  }, [active]);
  return started;
}

// 1. A tilted wall of real posters drifting in opposite directions, logo on top.
function PosterWall({ posters, width, reduce }: SceneProps) {
  const w = Math.round(width / 3.6);
  const rows = [0, 1, 2, 3].map((r) => [...posters.slice(r * 4), ...posters.slice(0, r * 4)].slice(0, 8));
  return (
    <View style={{ flex: 1 }}>
      <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-12deg' }, { scale: 1.25 }], justifyContent: 'center', gap: 10 }]}>
        {rows.map((row, r) => (
          <DriftRow key={r} dir={r % 2 ? 1 : -1} w={w} reduce={reduce}>
            {[...row, ...row].map((u, i) => (
              <Poster key={i} uri={u} w={w} />
            ))}
          </DriftRow>
        ))}
      </View>
      {bottomEdge}
      <View style={styles.wallLogo}>
        <Animated.View entering={reduce ? undefined : FadeInDown.duration(600)}>
          <Brand size={64} />
        </Animated.View>
      </View>
    </View>
  );
}

function DriftRow({ dir, w, reduce, children }: { dir: 1 | -1; w: number; reduce: boolean; children: ReactNode }) {
  const span = (w + 10) * 8;
  const x = useSharedValue(0);
  useEffect(() => {
    if (!reduce) x.value = withRepeat(withTiming(1, { duration: 38000, easing: Easing.linear }), -1);
  }, [reduce, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: dir === 1 ? -span + x.value * span : -x.value * span }] }));
  return <Animated.View style={[{ flexDirection: 'row', gap: 10 }, style]}>{children}</Animated.View>;
}

// 2. Three Top 10 posters fan out, with big rank numbers.
function TopTen({ posters, active, width, reduce }: SceneProps) {
  const w = Math.round(width * 0.46);
  const started = useStarted(active);
  const t = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (started && !reduce) t.value = withSpring(1, springs.soft);
  }, [started, reduce, t]);
  // Podium: #2 on the left, #3 on the right, #1 in the middle (drawn last, on top).
  const ranks = [1, 2, 0];
  return (
    <View style={styles.centerScene}>
      {ranks.map((r) => (
        <FanCard key={r} rank={r} t={t} w={w} uri={posters[r]} />
      ))}
    </View>
  );
}

// rank 0 = #1 (centre), 1 = #2 (left), 2 = #3 (right).
const SIDE = [0, -1, 1];
function FanCard({ rank, t, w, uri }: { rank: number; t: SharedValue<number>; w: number; uri?: string }) {
  const side = SIDE[rank];
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(t.value, [0, 1], [0, side * w * 0.58]) },
      { translateY: interpolate(t.value, [0, 1], [0, side === 0 ? -10 : 14]) },
      { rotate: `${interpolate(t.value, [0, 1], [0, side * 9])}deg` },
      { scale: side === 0 ? 1.08 : 0.92 },
    ],
  }));
  return (
    <Animated.View style={[{ position: 'absolute' }, style]}>
      <Poster uri={uri} w={w} style={styles.shadow} />
      <Text style={[styles.rank, side === 1 && styles.rankRight]}>{rank + 1}</Text>
    </Animated.View>
  );
}

// 3. A search bar that types by itself; the real results for that search appear.
const QUERY = 'Solo Leveling';
function SearchDemo({ results, active, width, reduce }: SceneProps) {
  const [typed, setTyped] = useState(reduce ? QUERY : '');
  const started = useStarted(active);
  // Types once, the first time the page is shown; afterwards it stays typed.
  useEffect(() => {
    if (!started || reduce) return;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setTyped(QUERY.slice(0, i));
      if (i >= QUERY.length) clearInterval(t);
    }, 110);
    return () => clearInterval(t);
  }, [started, reduce]);
  const done = typed.length === QUERY.length;
  const w = Math.round((width - 80) / 3);
  return (
    <View style={[styles.centerScene, { justifyContent: 'flex-start', paddingTop: 50, paddingHorizontal: 28 }]}>
      <View style={styles.mockSearch}>
        <Icon name="search" size={18} color={colors.accent} />
        <Text style={styles.mockSearchText}>
          {typed}
          <Text style={{ color: colors.accent }}>|</Text>
        </Text>
      </View>
      {done ? (
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 22 }}>
          {[0, 1, 2].map((i) => (
            <Animated.View key={i} entering={reduce ? undefined : FadeInDown.delay(i * 110).duration(380)}>
              <Poster uri={results[i]?.image2x || results[i]?.image || undefined} w={w} />
              <Text style={styles.mockTitle} numberOfLines={1}>
                {results[i]?.title || ' '}
              </Text>
            </Animated.View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// 4. A week strip, a featured "next episode" card with a big ticking clock,
// and a new-episode notification sliding in.
function ScheduleDemo({ items, posters, active, width, reduce }: SceneProps) {
  const started = useStarted(active);

  // Week strip: the pill glides to today.
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i - 3);
        return { key: i, name: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3), num: d.getDate(), today: i === 3 };
      }),
    []
  );
  const cellW = Math.floor((width - 48) / 7);
  const pill = useSharedValue(reduce ? 3 : 0);
  // Notification and card entrance.
  const note = useSharedValue(reduce ? 1 : 0);
  const card = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!started || reduce) return;
    pill.value = withDelay(150, withTiming(3, { duration: 700, easing: Easing.bezier(0.2, 0.9, 0.25, 1) }));
    card.value = withDelay(250, withSpring(1, springs.soft));
    note.value = withDelay(1300, withSpring(1, springs.soft));
  }, [started, reduce, pill, card, note]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pill.value * cellW }] }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: card.value, transform: [{ translateY: (1 - card.value) * 30 }, { scale: 0.96 + card.value * 0.04 }] }));
  const noteStyle = useAnimatedStyle(() => ({ opacity: note.value, transform: [{ translateY: (1 - note.value) * -70 }] }));

  // The clock ticks only while the page is on screen.
  const [left, setLeft] = useState(2 * 3600 + 14 * 60 + 39);
  useEffect(() => {
    if (!active || reduce) return;
    const t = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 2 * 3600)), 1000);
    return () => clearInterval(t);
  }, [active, reduce]);
  const hh = String(Math.floor(left / 3600)).padStart(2, '0');
  const mm = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  const show = items[6];
  const out = items[7];
  return (
    <View style={[styles.centerScene, { paddingHorizontal: 24, gap: 16 }]}>
      {/* New episode notification */}
      <Animated.View style={[styles.note, noteStyle]}>
        <View style={styles.noteIcon}>
          <Icon name="play" size={14} color="#000" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.noteTitle} numberOfLines={1}>
            New episode out now
          </Text>
          <Text style={styles.noteSub} numberOfLines={1}>
            {out?.title || 'Your show'} · EP 7
          </Text>
        </View>
        <Text style={styles.noteTime}>now</Text>
      </Animated.View>

      {/* Week strip */}
      <View style={[styles.week, { width: cellW * 7 }]}>
        <Animated.View style={[styles.weekPill, { width: cellW }, pillStyle]} />
        {days.map((d) => (
          <View key={d.key} style={[styles.weekCell, { width: cellW }]}>
            <Text style={[styles.weekName, d.today && styles.weekOn]}>{d.today ? 'Today' : d.name}</Text>
            <Text style={[styles.weekNum, d.today && styles.weekOn]}>{d.num}</Text>
          </View>
        ))}
      </View>

      {/* Featured next episode */}
      <Animated.View style={[styles.feature, cardStyle]}>
        <LinearGradient colors={['rgba(255,100,10,0.28)', 'rgba(255,100,10,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <Poster uri={posters[6]} w={86} style={styles.shadow} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <PulseDot active={active && !reduce} />
            <Text style={styles.featureKicker}>NEXT EPISODE</Text>
          </View>
          <Text style={styles.featureTitle} numberOfLines={2}>
            {show?.title || 'Coming up'}
          </Text>
          <Text style={styles.featureEp}>Episode 8</Text>
          <View style={styles.clock}>
            {[hh, mm, ss].map((v, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={styles.clockBox}>
                  <Text style={styles.clockText}>{v}</Text>
                </View>
                {i < 2 ? <Text style={styles.clockColon}>:</Text> : null}
              </View>
            ))}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function PulseDot({ active }: { active: boolean }) {
  const p = useSharedValue(1);
  useEffect(() => {
    if (active) p.value = withRepeat(withSequence(withTiming(2.2, { duration: 1000 }), withTiming(1, { duration: 0 })), -1);
  }, [active, p]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: p.value }], opacity: interpolate(p.value, [1, 2.2], [0.6, 0]) }));
  return (
    <View style={{ width: 8, height: 8, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[styles.pulseRing, ring]} />
      <View style={styles.pulseDot} />
    </View>
  );
}

// 5. Posters drop into My List one by one; a "continue watching" bar fills.
function ListDemo({ items, posters, active, width, reduce }: SceneProps) {
  const started = useStarted(active);
  const [count, setCount] = useState(reduce ? 3 : 0);
  const fill = useSharedValue(reduce ? 0.62 : 0);
  const cont = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!started || reduce) return;
    const timers = [0, 1, 2].map((i) => setTimeout(() => setCount(i + 1), 350 + i * 320));
    cont.value = withDelay(1350, withSpring(1, springs.soft));
    fill.value = withDelay(1650, withTiming(0.62, { duration: 900, easing: Easing.out(Easing.cubic) }));
    return () => timers.forEach(clearTimeout);
  }, [started, reduce, cont, fill]);
  const contStyle = useAnimatedStyle(() => ({ opacity: cont.value, transform: [{ translateY: (1 - cont.value) * 24 }] }));
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0.02, fill.value) }] }));
  const pw = Math.round((width - 48 - 32 - 20) / 3);
  return (
    <View style={[styles.centerScene, { paddingHorizontal: 24, gap: 14 }]}>
      <View style={styles.listCard}>
        <View style={styles.listHead}>
          <Icon name="bookmarkOn" size={18} color={colors.accent} />
          <Text style={styles.listTitle}>My List</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.slotBox, { width: pw, height: pw * 1.5 }]}>
              {i < count ? (
                <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(14)} style={StyleSheet.absoluteFill}>
                  <Poster uri={posters[9 + i]} w={pw} />
                  <View style={styles.ribbon}>
                    <Icon name="check" size={11} color="#000" />
                  </View>
                </Animated.View>
              ) : null}
            </View>
          ))}
        </View>
      </View>
      <Animated.View style={[styles.contCard, contStyle]}>
        <Poster uri={posters[12]} w={40} />
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.contTitle} numberOfLines={1}>
            {items[12]?.title || 'Continue watching'}
          </Text>
          <Text style={styles.contSub}>Continue · Episode 5</Text>
          <View style={styles.contTrack}>
            <Animated.View style={[styles.contFill, fillStyle]} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// Short notice on the last page; the full text opens in a sheet.
function TermsNotice({ onRead }: { onRead: () => void }) {
  return (
    <View style={styles.terms}>
      <Icon name="shield" size={16} color={colors.accent} />
      <Text style={styles.termsText}>
        AnimeVerse is an independent, unofficial app. Your lists and settings stay on this phone. By tapping Get Started you agree to the{' '}
        <Text style={styles.termsLink} onPress={onRead}>
          Terms & Privacy
        </Text>
        .
      </Text>
    </View>
  );
}

const TERMS: { title: string; body: string[] }[] = [
  {
    title: 'About AnimeVerse',
    body: [
      'AnimeVerse is an independent, unofficial third-party app for discovering and watching anime. It is not affiliated with, endorsed or sponsored by any anime studio, publisher, distributor or streaming service.',
      'Anime titles, artwork, logos, characters and trademarks belong to their respective owners and are shown only to identify the shows.',
    ],
  },
  {
    title: 'Using the app',
    body: [
      'AnimeVerse is for personal, non-commercial use. You are responsible for using it in line with the laws where you live.',
      'Shows, episodes and features can change or become unavailable at any time, without notice.',
      'Please don’t resell, redistribute or misuse the app or its content.',
      'The app is provided “as is”, without warranties of any kind.',
    ],
  },
  {
    title: 'Privacy',
    body: [
      'No account or sign-up is needed, and AnimeVerse doesn’t ask for your name, email or other personal details.',
      'My List, watch history and progress, recent searches, settings, and saved pages and images are stored only on this phone. Clearing the app’s data or uninstalling it removes them.',
      'To show anime information and pictures, the app connects to online services. Like any internet request, these services can see basic technical details such as your IP address.',
      'The app doesn’t include advertising or analytics tools.',
    ],
  },
  {
    title: 'Changes',
    body: ['These terms may be updated from time to time. Continuing to use the app means you accept the current version.'],
  },
];

function TermsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Terms & Privacy" subtitle="Please read before you start">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 18 }}>
        {TERMS.map((s) => (
          <View key={s.title} style={{ gap: 8 }}>
            <Text style={styles.termsHead}>{s.title}</Text>
            {s.body.map((p, i) => (
              <Text key={i} style={styles.termsBody}>
                {p}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  note: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#1b1c22', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  noteIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  noteTitle: { color: '#fff', fontFamily: fonts.black, fontSize: 13.5 },
  noteSub: { color: colors.text2, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
  noteTime: { color: colors.muted, fontFamily: fonts.regular, fontSize: 11.5 },
  week: { flexDirection: 'row', height: 56 },
  weekPill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 14, backgroundColor: colors.accent },
  weekCell: { alignItems: 'center', justifyContent: 'center' },
  weekName: { color: colors.muted, fontFamily: fonts.bold, fontSize: 10.5 },
  weekNum: { color: '#fff', fontFamily: fonts.black, fontSize: 16, marginTop: 2 },
  weekOn: { color: '#000' },
  feature: { alignSelf: 'stretch', flexDirection: 'row', gap: 14, padding: 14, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(255,100,10,0.35)' },
  featureKicker: { color: colors.accent, fontFamily: fonts.black, fontSize: 11, letterSpacing: 1.6 },
  featureTitle: { color: '#fff', fontFamily: fonts.black, fontSize: 16, lineHeight: 20 },
  featureEp: { color: colors.text2, fontFamily: fonts.bold, fontSize: 12.5 },
  clock: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  clockBox: { minWidth: 40, height: 38, paddingHorizontal: 6, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  clockText: { color: '#fff', fontFamily: fonts.display, fontSize: 19, fontVariant: ['tabular-nums'] },
  clockColon: { color: 'rgba(255,255,255,0.4)', fontFamily: fonts.black, fontSize: 18, marginHorizontal: 4 },
  listCard: { alignSelf: 'stretch', padding: 16, gap: 14, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  listHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listTitle: { flex: 1, color: '#fff', fontFamily: fonts.black, fontSize: 17 },
  countBadge: { minWidth: 26, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#000', fontFamily: fonts.black, fontSize: 12 },
  slotBox: { borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  ribbon: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  contCard: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  contTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  contSub: { color: colors.accent, fontFamily: fonts.bold, fontSize: 12 },
  contTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  contFill: { height: '100%', width: '100%', backgroundColor: colors.accent, transformOrigin: 'left' },
  terms: { flexDirection: 'row', gap: 10, marginTop: 6, padding: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  termsText: { flex: 1, color: colors.text2, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18 },
  termsLink: { color: colors.accent, fontFamily: fonts.bold },
  termsHead: { color: '#fff', fontFamily: fonts.black, fontSize: 15.5 },
  termsBody: { color: colors.text2, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  screen: { flex: 1, backgroundColor: colors.bg },
  textBlock: { paddingHorizontal: 28, paddingTop: 26, gap: 12 },
  title: { color: '#fff', fontFamily: fonts.display, fontSize: 30, lineHeight: 35, letterSpacing: -0.8 },
  text: { color: colors.text2, fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 23 },
  skip: { position: 'absolute', right: 18, paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center' },
  skipText: { color: '#fff', fontFamily: fonts.bold, fontSize: 14 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  dots: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  dot: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 52, paddingHorizontal: 26, borderRadius: 26, backgroundColor: colors.accent },
  ctaWide: { paddingHorizontal: 30 },
  ctaText: { color: '#000', fontFamily: fonts.black, fontSize: 16 },
  centerScene: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wallLogo: { position: 'absolute', left: 0, right: 0, bottom: 26, alignItems: 'center' },
  shadow: { shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 14 },
  rankRight: { left: undefined, right: -6 },
  rank: { position: 'absolute', left: -10, bottom: -18, color: '#fff', fontFamily: fonts.display, fontSize: 72, letterSpacing: -4, textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 14 },
  mockSearch: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 16, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.accent },
  mockSearchText: { color: '#fff', fontFamily: fonts.bold, fontSize: 16 },
  mockTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 12, marginTop: 6, maxWidth: 110 },
  pulseRing: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
});
