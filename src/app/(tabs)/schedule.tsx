import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { posterOf, useArt } from '@/lib/artwork';
import { countdown } from '@/lib/format';
import { scheduleDateOptions, useScheduleDate } from '@/lib/queries';
import { dateKey } from '@/lib/scheduleByDate';
import { useTitle } from '@/lib/settings';
import { colors, fonts } from '@/lib/theme';
import type { Anime } from '@/lib/types';

// Date strip: two weeks back, today, and the two weeks ahead (28 days).
const BACK = 14;
const AHEAD = 13;
const TODAY = BACK; // index of today in the strip
const CHIP_W = 58;
const CHIP_GAP = 8;
const PAD = 16;
const chipX = (i: number) => PAD + i * (CHIP_W + CHIP_GAP);
const EASE = Easing.bezier(0.2, 0.9, 0.25, 1);

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const days = useMemo(
    () =>
      Array.from({ length: BACK + 1 + AHEAD }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i - BACK);
        return {
          key: dateKey(d),
          weekday: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase(),
          num: d.getDate(),
          month: d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
          past: i < TODAY,
          today: i === TODAY,
        };
      }),
    []
  );

  const [selected, setSelected] = useState(TODAY);
  // The list follows a moment after the pill (deferred), so a tap never stalls.
  const shown = useDeferredValue(selected);
  const day = days[shown];
  const q = useScheduleDate(day.key, day.past);

  // Only today loads on open; yesterday and tomorrow are fetched quietly once it's in.
  const qc = useQueryClient();
  const prefetched = useRef(false);
  useEffect(() => {
    if (prefetched.current || shown !== TODAY || !q.data) return;
    prefetched.current = true;
    [TODAY - 1, TODAY + 1].forEach((i) => qc.prefetchQuery(scheduleDateOptions(days[i].key, days[i].past)).catch(() => {}));
  }, [shown, q.data, qc, days]);

  // Back on this tab: refresh the day on screen only if it's out of date.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      qc.refetchQueries({ queryKey: ['scheduleDate'], stale: true, type: 'active' }).catch(() => {});
    }, [qc])
  );

  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30000);
    return () => clearInterval(t);
  }, []);

  // ---- Date strip: pill slides; the chosen day sits second from the left ----
  const stripRef = useRef<ScrollViewInstance>(null);
  const px = useSharedValue(chipX(TODAY));
  const firstSelect = useRef(true);
  useEffect(() => {
    const target = chipX(selected);
    if (firstSelect.current) {
      firstSelect.current = false;
      px.value = target;
      return;
    }
    px.value = withTiming(target, { duration: 280, easing: EASE });
    stripRef.current?.scrollTo({ x: Math.max(0, chipX(selected - 1) - PAD), animated: true });
  }, [selected, px]);
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: px.value }] }));

  // ---- List ----
  const sorted = useMemo(
    () => (q.data ? [...q.data].sort((a, b) => (a.nextEpisode?.airingAt || 9e9) - (b.nextEpisode?.airingAt || 9e9)) : null),
    [q.data]
  );
  const firstUpcoming = useMemo(() => (day.today ? sorted?.findIndex((a) => (a.nextEpisode?.airingAt || 0) > now) ?? -1 : -1), [sorted, now, day.today]);
  const listRef = useRef<FlatList<Anime>>(null);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [shown]);

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + 12 }}>
        <Text style={styles.title}>Release Schedule</Text>
        <Text style={styles.sub}>Times are in your local time</Text>

        <ScrollView
          ref={stripRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
          // Opens with today second from the left (yesterday just before it).
          contentOffset={{ x: chipX(TODAY - 1) - PAD, y: 0 }}
          onLayout={() => stripRef.current?.scrollTo({ x: chipX(TODAY - 1) - PAD, animated: false })}
        >
          <Animated.View style={[styles.pill, pillStyle]}>
            <LinearGradient colors={['#FF8A2A', colors.accent, '#F0440C']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
          {days.map((d, i) => {
            const on = i === selected;
            return (
              <PressableScale key={d.key} haptic onPress={() => setSelected(i)} style={styles.chip} scaleTo={0.94} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${d.today ? 'Today, ' : ''}${d.weekday} ${d.num} ${d.month}`}>
                <Text style={[styles.chipDay, on && styles.chipOn, !on && d.past && styles.chipPast]}>{d.today ? 'TODAY' : d.weekday}</Text>
                <Text style={[styles.chipNum, on && styles.chipOn, !on && d.past && styles.chipPast]}>{d.num}</Text>
                <Text style={[styles.chipMonth, on && styles.chipOnSoft]}>{d.month}</Text>
                {d.today && !on ? <View style={styles.todayDot} /> : null}
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      {!sorted ? (
        q.error ? (
          <ErrorState message={q.error.message || 'Something went wrong'} onRetry={() => q.refetch()} />
        ) : (
          <ScheduleSkeleton />
        )
      ) : (
        <Animated.View key={day.key} entering={FadeIn.duration(220)} style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={sorted}
            // The same show can air twice in a day, so the key includes the episode and position.
            keyExtractor={(a, i) => `${a.id}-${a.nextEpisode?.episode ?? ''}-${i}`}
            contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 100 }}
            ListEmptyComponent={<EmptyState icon="calendar" title="Nothing scheduled" text="No episodes are listed for this day." />}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={7}
            removeClippedSubviews={Platform.OS === 'android'}
            renderItem={({ item, index }) => (
              <Row anime={item} now={now} first={index === 0} last={index === sorted.length - 1} showNow={index === firstUpcoming && index > 0} />
            )}
          />
        </Animated.View>
      )}
    </View>
  );
}

// One timeline row: time on the left, a rail with a dot, then the show.
const Row = memo(function Row({ anime, now, first, last, showNow }: { anime: Anime; now: number; first: boolean; last: boolean; showNow: boolean }) {
  const at = anime.nextEpisode?.airingAt;
  const released = !!at && at < now;
  const { art, settled } = useArt(anime);
  const thumb = settled ? posterOf(anime, art, false) : undefined;
  const title = useTitle(anime);
  const time = at ? new Date(at * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const [clock, ampm] = time.includes(' ') ? [time.slice(0, time.lastIndexOf(' ')), time.slice(time.lastIndexOf(' ') + 1)] : [time, ''];

  return (
    <>
      {showNow ? (
        <View style={styles.nowRow}>
          <View style={styles.timeCol} />
          <View style={styles.rail}>
            <View style={[styles.railLine, { top: 0, bottom: 0 }]} />
            <View style={styles.nowBadge}>
              <Text style={styles.nowText}>NOW</Text>
            </View>
          </View>
          <View style={styles.nowRule} />
        </View>
      ) : null}
      <PressableScale onPress={() => router.push(`/anime/${anime.id}`)} style={styles.row} scaleTo={0.985} accessibilityLabel={`${title}, episode ${anime.nextEpisode?.episode ?? ''}, ${time}`}>
        <View style={styles.timeCol}>
          <Text style={[styles.time, released && styles.dim]}>{clock || '—'}</Text>
          {ampm ? <Text style={styles.ampm}>{ampm}</Text> : null}
        </View>
        <View style={styles.rail}>
          <View style={[styles.railLine, { top: first ? 22 : 0, bottom: last ? undefined : 0, height: last ? 22 : undefined }]} />
          <View style={[styles.dot, released ? styles.dotDone : styles.dotNext]} />
        </View>
        <View style={styles.show}>
          <View style={styles.thumb}>{thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} cachePolicy="memory-disk" /> : null}</View>
          <View style={{ flex: 1, paddingTop: 2 }}>
            <Text style={[styles.name, released && styles.nameDone]} numberOfLines={2}>
              {title}
            </Text>
            {anime.nextEpisode ? <Text style={styles.ep}>EPISODE {anime.nextEpisode.episode}</Text> : null}
            <View style={styles.statusRow}>
              {released ? (
                <>
                  <Icon name="check" size={13} color={colors.green} />
                  <Text style={[styles.status, { color: colors.green }]}>Released</Text>
                </>
              ) : (
                <Text style={styles.status}>in {countdown((at || 0) - now)}</Text>
              )}
              {anime.score ? (
                <>
                  <Text style={styles.sep}>·</Text>
                  <Icon name="star" size={12} color={colors.star} />
                  <Text style={styles.status}>{anime.score.toFixed(1)}</Text>
                </>
              ) : null}
            </View>
          </View>
        </View>
      </PressableScale>
    </>
  );
});

function ScheduleSkeleton() {
  return (
    <View style={{ paddingTop: 10 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.row}>
          <View style={styles.timeCol}>
            <Skeleton width={42} height={14} />
          </View>
          <View style={styles.rail}>
            <View style={[styles.dot, styles.dotDone]} />
          </View>
          <View style={styles.show}>
            <Skeleton width={56} height={80} rounded={10} />
            <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
              <Skeleton width="80%" height={14} />
              <Skeleton width="40%" height={11} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: '#fff', fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.6, paddingHorizontal: 16 },
  sub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 16, marginTop: 4 },

  strip: { paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 14, gap: CHIP_GAP },
  pill: { position: 'absolute', top: 16, left: 0, width: CHIP_W, height: 78, borderRadius: 18, overflow: 'hidden', shadowColor: colors.accent, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  chip: { width: CHIP_W, height: 78, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 1 },
  chipDay: { color: colors.text2, fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.8 },
  chipNum: { color: '#fff', fontFamily: fonts.display, fontSize: 22, letterSpacing: -0.5 },
  chipMonth: { color: colors.muted, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 0.8 },
  chipPast: { color: 'rgba(255,255,255,0.45)' },
  chipOn: { color: '#fff' },
  chipOnSoft: { color: 'rgba(255,255,255,0.85)' },
  todayDot: { position: 'absolute', bottom: 6, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accent },

  row: { flexDirection: 'row', paddingHorizontal: 16 },
  timeCol: { width: 58, paddingTop: 12, alignItems: 'flex-end' },
  time: { color: '#fff', fontFamily: fonts.black, fontSize: 15, fontVariant: ['tabular-nums'] },
  ampm: { color: colors.muted, fontFamily: fonts.medium, fontSize: 11, marginTop: 1 },
  dim: { color: colors.muted },
  rail: { width: 30, alignItems: 'center' },
  railLine: { position: 'absolute', width: 2, backgroundColor: 'rgba(255,255,255,0.08)' },
  dot: { marginTop: 16, width: 11, height: 11, borderRadius: 6 },
  dotNext: { backgroundColor: colors.accent, borderWidth: 2, borderColor: 'rgba(255,100,10,0.35)' },
  dotDone: { backgroundColor: '#3a3c44' },
  show: { flex: 1, flexDirection: 'row', gap: 12, paddingVertical: 10 },
  thumb: { width: 56, height: 80, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface2 },
  name: { color: '#fff', fontFamily: fonts.bold, fontSize: 15.5, lineHeight: 20 },
  nameDone: { color: colors.text2 },
  ep: { color: colors.accent, fontFamily: fonts.black, fontSize: 11, letterSpacing: 1, marginTop: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  status: { color: colors.muted, fontFamily: fonts.medium, fontSize: 12.5 },
  sep: { color: colors.muted, marginHorizontal: 2 },

  nowRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 28 },
  nowBadge: { paddingHorizontal: 6, height: 18, borderRadius: 9, backgroundColor: colors.accent, justifyContent: 'center' },
  nowText: { color: '#000', fontFamily: fonts.black, fontSize: 9.5, letterSpacing: 1 },
  nowRule: { flex: 1, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,100,10,0.45)' },
});
