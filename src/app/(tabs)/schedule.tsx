import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LangBadges, Score } from '@/components/Badges';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { api } from '@/lib/api';
import { countdown } from '@/lib/format';
import { colors, fonts, radius } from '@/lib/theme';
import type { Anime } from '@/lib/types';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const EASE = Easing.out(Easing.cubic);

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

  // The whole week is loaded once and kept here, so switching days just swaps
  // which list is shown: no loading flash, no second fetch.
  const [lists, setLists] = useState<Record<string, Anime[]>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const dayRef = useRef(day);
  dayRef.current = day;
  const loadDay = useCallback((key: string) => {
    return api
      .schedule(key)
      .then((items) => {
        setLists((l) => (l[key] === items ? l : { ...l, [key]: items }));
        return items;
      })
      .catch((e: Error) => {
        if (key === dayRef.current) setFailed(e.message);
        throw e;
      });
  }, []);

  useEffect(() => {
    // Today first, then the rest of the week in the background.
    loadDay(todayKey)
      .catch(() => {})
      .finally(() => week.filter((w) => w.key !== todayKey).forEach((w) => loadDay(w.key).catch(() => {})));
  }, [loadDay, todayKey, week]);

  useEffect(() => {
    if (!lists[day]) loadDay(day).catch(() => {});
  }, [day, lists, loadDay]);

  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30000);
    return () => clearInterval(t);
  }, []);

  // Orange pill that glides between days (timed, not springy, so it settles fast).
  const layouts = useRef<Record<string, { x: number; w: number }>>({});
  const px = useSharedValue(0);
  const pw = useSharedValue(0);
  const placePill = useCallback(
    (key: string, animate: boolean) => {
      const l = layouts.current[key];
      if (!l) return;
      if (!animate || pw.value === 0) {
        px.value = l.x;
        pw.value = l.w;
      } else {
        px.value = withTiming(l.x, { duration: 240, easing: EASE });
        pw.value = withTiming(l.w, { duration: 240, easing: EASE });
      }
    },
    [px, pw]
  );
  useEffect(() => placePill(day, true), [day, placePill]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: px.value }], width: pw.value }));

  const items = lists[day];
  const sorted = useMemo(
    () => (items ? [...items].sort((a, b) => (a.nextEpisode?.airingAt || 9e9) - (b.nextEpisode?.airingAt || 9e9)) : null),
    [items]
  );
  const firstUpcoming = useMemo(() => sorted?.findIndex((a) => (a.nextEpisode?.airingAt || 0) > now) ?? -1, [sorted, now]);

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + 12 }}>
        <Text style={styles.title}>Release Schedule</Text>
        <Text style={styles.sub}>New episodes this week, in your local time</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
          <Animated.View style={[styles.pill, pill]} />
          {week.map((w) => {
            const on = w.key === day;
            const count = lists[w.key]?.length;
            return (
              <PressableScale
                key={w.key}
                haptic
                onPress={() => setDay(w.key)}
                onLayout={(e: LayoutChangeEvent) => {
                  layouts.current[w.key] = { x: e.nativeEvent.layout.x, w: e.nativeEvent.layout.width };
                  if (w.key === day) placePill(day, false);
                }}
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
          <ErrorState message={failed} onRetry={() => { setFailed(null); loadDay(day).catch(() => {}); }} />
        ) : (
          <View style={{ padding: 16, gap: 10 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} width="100%" height={92} rounded={radius.md} />
            ))}
          </View>
        )
      ) : (
        // A quick crossfade when the day changes; rows don't re-animate one by one.
        <Animated.View key={day} entering={FadeIn.duration(180)} style={{ flex: 1 }}>
          <FlatList
            data={sorted}
            // A show can release two episodes on the same day, so the episode is part of the key.
            keyExtractor={(a) => `${a.id}-${a.nextEpisode?.episode ?? ''}`}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
            ListEmptyComponent={<EmptyState icon="calendar" title="Nothing scheduled" text="No episodes are listed for this day yet." />}
            initialNumToRender={8}
            windowSize={7}
            renderItem={({ item, index }) => <Slot anime={item} now={now} showNow={day === todayKey && index === firstUpcoming && index > 0} />}
          />
        </Animated.View>
      )}
    </View>
  );
}

const Slot = memo(function Slot({ anime, now, showNow }: { anime: Anime; now: number; showNow: boolean }) {
  const at = anime.nextEpisode?.airingAt;
  const past = !!at && at < now;
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
        {anime.image ? <Image source={{ uri: anime.image }} style={styles.thumb} contentFit="cover" transition={150} cachePolicy="memory-disk" /> : <View style={styles.thumb} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={2}>
            {anime.title}
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
  days: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  pill: { position: 'absolute', top: 14, left: 0, height: 60, borderRadius: radius.md, backgroundColor: colors.accent },
  day: { minWidth: 72, height: 60, borderRadius: radius.md, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  dayName: { color: colors.muted, fontFamily: fonts.black, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  dayDate: { color: '#fff', fontFamily: fonts.black, fontSize: 15, marginTop: 1 },
  dayCount: { color: colors.muted, fontFamily: fonts.bold, fontSize: 10.5, marginTop: 1 },
  dayCountOn: { color: 'rgba(0,0,0,0.6)' },
  dayOn: { color: '#000' },
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
