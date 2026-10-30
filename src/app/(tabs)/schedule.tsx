import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LangBadges, Score } from '@/components/Badges';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { useQueryClient } from '@tanstack/react-query';
import { posterOf, useArt } from '@/lib/artwork';
import { countdown } from '@/lib/format';
import { useScheduleWeek } from '@/lib/queries';
import { colors, fonts, radius } from '@/lib/theme';
import type { Anime } from '@/lib/types';
import { useTitle } from '@/lib/settings';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const EASE = Easing.out(Easing.cubic);
// Every day button is the same width, so the pill only ever slides (a cheap
// transform) and never resizes, which would re-layout on every frame.
const DAY_W = 78;
const DAY_GAP = 8;
const DAY_PAD = 16;
const dayX = (i: number) => DAY_PAD + i * (DAY_W + DAY_GAP);

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const todayKey = DAYS[new Date().getDay()];
  const week = useMemo(
    () =>
      DAYS.map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return { key: DAYS[d.getDay()], date: d, today: i === 0 };
      }),
    []
  );
  const [day, setDay] = useState(todayKey);

  // The whole week loads at once and is saved on the phone: switching days only
  // swaps which list is shown, and reopening the app shows it instantly. Each
  // day refreshes in the background once it's an hour old.
  const dayKeys = useMemo(() => week.map((w) => w.key), [week]);
  const { lists, errors } = useScheduleWeek(dayKeys);

  // Coming back to this tab refreshes only the days that are out of date.
  const qc = useQueryClient();
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      qc.refetchQueries({ queryKey: ['schedule'], stale: true, type: 'active' }).catch(() => {});
    }, [qc])
  );

  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30000);
    return () => clearInterval(t);
  }, []);

  // Orange pill that glides between days. It moves on the UI thread right away;
  // the list below catches up a moment later (deferred), so a tap never stalls.
  const dayIndex = Math.max(0, week.findIndex((w) => w.key === day));
  const px = useSharedValue(dayX(dayIndex));
  const daysRef = useRef<ScrollViewInstance>(null);
  const { width: screenW } = useWindowDimensions();
  useEffect(() => {
    px.value = withTiming(dayX(dayIndex), { duration: 260, easing: EASE });
    // Keep the chosen day in view when it's near the edge.
    daysRef.current?.scrollTo({ x: Math.max(0, dayX(dayIndex) - (screenW - DAY_W) / 2), animated: true });
  }, [dayIndex, px, screenW]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: px.value }] }));

  // The list renders the deferred day: React draws the pill/labels first and
  // swaps the (heavier) list right after, instead of both in one frame.
  const shownDay = useDeferredValue(day);

  const items = lists[shownDay];
  const failed = !items && errors[shownDay] ? errors[shownDay]!.message || 'Something went wrong' : null;
  const sorted = useMemo(
    () => (items ? [...items].sort((a, b) => (a.nextEpisode?.airingAt || 9e9) - (b.nextEpisode?.airingAt || 9e9)) : null),
    [items]
  );
  const firstUpcoming = useMemo(() => sorted?.findIndex((a) => (a.nextEpisode?.airingAt || 0) > now) ?? -1, [sorted, now]);

  // Day change: jump the list to the top and fade the new day in.
  const listRef = useRef<FlatList<Anime>>(null);
  const fade = useSharedValue(1);
  const firstDay = useRef(true);
  useEffect(() => {
    if (firstDay.current) {
      firstDay.current = false;
      return;
    }
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    fade.value = 0.3;
    fade.value = withTiming(1, { duration: 180, easing: EASE });
  }, [shownDay, fade]);
  const listFade = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + 12 }}>
        <Text style={styles.title}>Release Schedule</Text>
        <Text style={styles.sub}>New episodes this week, in your local time</Text>
        <ScrollView ref={daysRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
          <Animated.View style={[styles.pill, pill]} />
          {week.map((w) => {
            const on = w.key === day;
            const count = lists[w.key]?.length;
            return (
              <PressableScale
                key={w.key}
                haptic
                onPress={() => setDay(w.key)}
                style={styles.day}
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.dayName, on && styles.dayOn]}>{w.today ? 'Today' : w.date.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                <Text style={[styles.dayDate, on && styles.dayOn]}>{w.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
                {count != null ? <Text style={[styles.dayCount, on && styles.dayCountOn]}>{count}</Text> : null}
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      {!sorted ? (
        failed ? (
          <ErrorState message={failed} onRetry={() => { qc.refetchQueries({ queryKey: ['schedule', shownDay] }).catch(() => {}); }} />
        ) : (
          <View style={{ padding: 16, gap: 10 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} width="100%" height={92} rounded={radius.md} />
            ))}
          </View>
        )
      ) : (
        // One list that stays mounted: switching days swaps its data and fades it
        // in, instead of rebuilding the whole list (much cheaper on slower phones).
        <Animated.View style={[{ flex: 1 }, listFade]}>
          <FlatList
            ref={listRef}
            data={sorted}
            // The same show can appear twice in a day (two episodes, even at the
            // same time), so the key includes the episode and the row position.
            keyExtractor={(a, i) => `${a.id}-${a.nextEpisode?.episode ?? ''}-${i}`}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
            ListEmptyComponent={<EmptyState icon="calendar" title="Nothing scheduled" text="No episodes are listed for this day yet." />}
            initialNumToRender={7}
            maxToRenderPerBatch={6}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'android'}
            renderItem={({ item, index }) => <Slot anime={item} now={now} showNow={shownDay === todayKey && index === firstUpcoming && index > 0} />}
          />
        </Animated.View>
      )}
    </View>
  );
}

const Slot = memo(function Slot({ anime, now, showNow }: { anime: Anime; now: number; showNow: boolean }) {
  const at = anime.nextEpisode?.airingAt;
  const past = !!at && at < now;
  const { art, settled } = useArt(anime);
  const thumb = settled ? posterOf(anime, art, false) : undefined;
  const title = useTitle(anime);
  return (
    <>
      {showNow ? (
        <View style={styles.nowLine}>
          <View style={styles.nowDot} />
          <Text style={styles.nowText}>Now</Text>
          <View style={styles.nowRule} />
        </View>
      ) : null}
      <PressableScale onPress={() => router.push(`/anime/${anime.id}`)} style={[styles.slot, past && { opacity: 0.72 }]} scaleTo={0.98}>
        <Text style={[styles.time, past && { color: colors.muted }]}>
          {at ? new Date(at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
        </Text>
        {thumb ? <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" transition={150} cachePolicy="memory-disk" /> : <View style={styles.thumb} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.meta}>
            <Score value={anime.score} size={12} />
            <LangBadges anime={anime} />
          </View>
          {anime.nextEpisode ? (
            <Text style={styles.ep}>
              EP {anime.nextEpisode.episode}
              <Text style={styles.epWhen}>{past ? '  ·  Released' : `  ·  in ${countdown((at || 0) - now)}`}</Text>
            </Text>
          ) : null}
        </View>
        {past ? <Icon name="check" size={16} color={colors.green} /> : null}
      </PressableScale>
    </>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 28, paddingHorizontal: 16 },
  sub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 16, marginTop: 4 },
  days: { paddingHorizontal: DAY_PAD, paddingVertical: 14, gap: DAY_GAP },
  pill: { position: 'absolute', top: 14, left: 0, width: DAY_W, height: 60, borderRadius: radius.md, backgroundColor: colors.accent },
  day: { width: DAY_W, height: 60, borderRadius: radius.md, paddingHorizontal: 10, justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  dayName: { color: colors.muted, fontFamily: fonts.black, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  dayDate: { color: '#fff', fontFamily: fonts.black, fontSize: 15, marginTop: 1 },
  dayCount: { color: colors.muted, fontFamily: fonts.bold, fontSize: 10.5, marginTop: 1 },
  dayCountOn: { color: 'rgba(255,255,255,0.85)' },
  dayOn: { color: '#fff' },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  time: { width: 58, color: '#fff', fontFamily: fonts.black, fontSize: 14, textAlign: 'center' },
  thumb: { width: 50, height: 70, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  name: { color: '#fff', fontFamily: fonts.bold, fontSize: 14.5, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  ep: { color: colors.accent, fontFamily: fonts.black, fontSize: 12, marginTop: 5 },
  epWhen: { color: colors.muted, fontFamily: fonts.bold },
  nowLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 2 },
  nowDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.accent },
  nowText: { color: colors.accent, fontFamily: fonts.black, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase' },
  nowRule: { flex: 1, height: 2, backgroundColor: 'rgba(255,100,10,0.4)' },
});
