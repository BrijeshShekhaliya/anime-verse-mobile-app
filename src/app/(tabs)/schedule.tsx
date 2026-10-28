import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeInRight, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LangBadges, Score } from '@/components/Badges';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { api } from '@/lib/api';
import { countdown } from '@/lib/format';
import { colors, fonts, radius, springs } from '@/lib/theme';
import type { Anime } from '@/lib/types';
import { useFetch } from '@/lib/useFetch';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets();
  const todayIdx = new Date().getDay();
  const week = useMemo(
    () =>
      DAYS.map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        return { key: DAYS[d.getDay()], date: d, today: i === 0 };
      }),
    []
  );
  const [day, setDay] = useState(DAYS[todayIdx]);
  const { data, error, loading, reload } = useFetch(() => api.schedule(day), [day]);

  // Warm the rest of the week so switching days is instant.
  useEffect(() => {
    week.forEach((w) => api.schedule(w.key).catch(() => {}));
  }, [week]);

  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30000);
    return () => clearInterval(t);
  }, []);

  // Orange pill that slides between days.
  const [layouts, setLayouts] = useState<Record<string, { x: number; w: number }>>({});
  const px = useSharedValue(0);
  const pw = useSharedValue(0);
  useEffect(() => {
    const l = layouts[day];
    if (!l) return;
    // First placement is instant; after that the pill glides between days.
    if (pw.value === 0) {
      px.value = l.x;
      pw.value = l.w;
      return;
    }
    px.value = withSpring(l.x, springs.soft);
    pw.value = withSpring(l.w, springs.soft);
  }, [day, layouts, px, pw]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: px.value }], width: pw.value }));

  const sorted = useMemo(
    () => [...(data || [])].sort((a, b) => (a.nextEpisode?.airingAt || 9e9) - (b.nextEpisode?.airingAt || 9e9)),
    [data]
  );

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + 12 }}>
        <Text style={styles.title}>Release Schedule</Text>
        <Text style={styles.sub}>New episodes this week, in your local time</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
          <Animated.View style={[styles.pill, pill]} />
          {week.map((w) => {
            const on = w.key === day;
            return (
              <PressableScale
                key={w.key}
                haptic
                onPress={() => setDay(w.key)}
                onLayout={(e: LayoutChangeEvent) => {
                  const { x, width } = e.nativeEvent.layout;
                  setLayouts((l) => (l[w.key]?.x === x && l[w.key]?.w === width ? l : { ...l, [w.key]: { x, w: width } }));
                }}
                style={styles.day}
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.dayName, on && styles.dayOn]}>{w.today ? 'Today' : w.date.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                <Text style={[styles.dayDate, on && styles.dayOn]}>{w.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      </View>

      {loading && !data ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} width="100%" height={92} rounded={radius.md} />
          ))}
        </View>
      ) : error && !data ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <FlatList
          key={day}
          data={sorted}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 100 }}
          ListEmptyComponent={<EmptyState icon="calendar" title="Nothing scheduled" text="No episodes are listed for this day yet." />}
          renderItem={({ item, index }) => <Slot anime={item} index={index} now={now} showNow={day === DAYS[todayIdx]} prev={sorted[index - 1]} />}
        />
      )}
    </View>
  );
}

function Slot({ anime, index, now, showNow, prev }: { anime: Anime; index: number; now: number; showNow: boolean; prev?: Anime }) {
  const at = anime.nextEpisode?.airingAt;
  const past = !!at && at < now;
  const prevPast = !!prev?.nextEpisode?.airingAt && prev.nextEpisode.airingAt < now;
  const marker = showNow && !past && (index === 0 ? false : prevPast);
  return (
    <>
      {marker ? (
        <View style={styles.nowLine}>
          <View style={styles.nowDot} />
          <Text style={styles.nowText}>Now</Text>
          <View style={styles.nowRule} />
        </View>
      ) : null}
      <Animated.View entering={FadeInRight.delay(Math.min(index, 10) * 35).duration(320)}>
        <PressableScale onPress={() => router.push(`/anime/${anime.id}`)} style={[styles.slot, past && { opacity: 0.7 }]}>
          <Text style={[styles.time, past && { color: colors.muted }]}>
            {at ? new Date(at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
          </Text>
          {anime.image ? <Image source={{ uri: anime.image }} style={styles.thumb} contentFit="cover" transition={200} /> : <View style={styles.thumb} />}
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
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 28, paddingHorizontal: 16 },
  sub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, paddingHorizontal: 16, marginTop: 4 },
  days: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  pill: { position: 'absolute', top: 14, left: 0, height: 56, borderRadius: radius.md, backgroundColor: colors.accent },
  day: { minWidth: 72, height: 56, borderRadius: radius.md, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  dayName: { color: colors.muted, fontFamily: fonts.black, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  dayDate: { color: '#fff', fontFamily: fonts.black, fontSize: 15, marginTop: 2 },
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
