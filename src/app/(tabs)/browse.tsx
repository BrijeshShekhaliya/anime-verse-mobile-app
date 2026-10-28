import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/BottomSheet';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { PosterCard } from '@/components/PosterCard';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { api } from '@/lib/api';
import { colors, fonts, radius } from '@/lib/theme';
import type { Anime } from '@/lib/types';
import { useFetch } from '@/lib/useFetch';

const SORTS = [
  { key: '', label: 'Popular' },
  { key: 'score', label: 'Top rated' },
  { key: 'newest', label: 'Newest' },
  { key: 'title', label: 'A–Z' },
];
const STATUS = [
  { key: '', label: 'Any' },
  { key: 'airing', label: 'Airing' },
  { key: 'finished', label: 'Finished' },
  { key: 'upcoming', label: 'Upcoming' },
];
const TYPES = [
  { key: '', label: 'Any' },
  { key: 'tv', label: 'TV series' },
  { key: 'movie', label: 'Movie' },
  { key: 'ova', label: 'OVA' },
  { key: 'ona', label: 'ONA' },
  { key: 'special', label: 'Special' },
];

type Filters = { genre: string; type: string; status: string; order: string; dub: boolean };
const EMPTY: Filters = { genre: '', type: '', status: '', order: '', dub: false };
const label = (list: { key: string; label: string }[], key: string) => list.find((x) => x.key === key)?.label || key;

export default function BrowseScreen() {
  const params = useLocalSearchParams<{ genre?: string; type?: string; status?: string; order?: string; dub?: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cols = width >= 700 ? 5 : 3;
  const cardW = Math.floor((width - 32 - (cols - 1) * 12) / cols);

  const [filters, setFilters] = useState<Filters>(EMPTY);
  // "View all" links from Home arrive with filters in the URL.
  useEffect(() => {
    setFilters({
      genre: params.genre || '',
      type: params.type || '',
      status: params.status || '',
      order: params.order === 'popularity' ? '' : params.order || '',
      dub: params.dub === '1',
    });
  }, [params.genre, params.type, params.status, params.order, params.dub]);

  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const genres = useFetch(() => api.genres(), []);

  const [items, setItems] = useState<Anime[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const listRef = useRef<FlatList<Anime>>(null);

  const load = useCallback(
    async (p: number, gen: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.search({ ...filters, page: p });
        if (gen !== generation.current) return;
        setItems((prev) => {
          if (p === 1) return res.items;
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...res.items.filter((a) => !seen.has(a.id))];
        });
        setHasNext(res.hasNext);
        setPage(p);
      } catch (e) {
        if (gen === generation.current) setError((e as Error).message);
      } finally {
        if (gen === generation.current) setLoading(false);
      }
    },
    [filters]
  );

  // New filters start again from the top, page 1 only.
  useEffect(() => {
    generation.current += 1;
    setItems([]);
    setHasNext(true);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    load(1, generation.current);
  }, [load]);

  const activeCount = [filters.genre, filters.type, filters.status, filters.dub ? 'dub' : ''].filter(Boolean).length;
  const active: { key: keyof Filters; text: string }[] = [
    filters.dub ? { key: 'dub' as const, text: 'English dub' } : null,
    filters.status ? { key: 'status' as const, text: label(STATUS, filters.status) } : null,
    filters.type ? { key: 'type' as const, text: label(TYPES, filters.type) } : null,
    filters.genre ? { key: 'genre' as const, text: filters.genre } : null,
  ].filter(Boolean) as { key: keyof Filters; text: string }[];
  const title = filters.dub ? 'English Dubbed' : filters.genre ? `${filters.genre} Anime` : 'Browse';

  const header = (
    <View style={{ paddingTop: insets.top + 12 }}>
      <Text style={styles.title}>{title}</Text>
      <PressableScale onPress={() => router.push('/search')} style={styles.searchBar} scaleTo={0.98} accessibilityLabel="Search">
        <Icon name="search" size={18} color={colors.muted} />
        <Text style={styles.searchText}>Search anime</Text>
      </PressableScale>

      <View style={styles.toolbar}>
        <PressableScale haptic onPress={() => setSortOpen(true)} style={styles.toolBtn} accessibilityLabel="Sort">
          <Text style={styles.toolLabel}>Sort</Text>
          <Text style={styles.toolValue}>{label(SORTS, filters.order)}</Text>
          <Icon name="down" size={15} color={colors.muted} />
        </PressableScale>
        <PressableScale
          haptic
          onPress={() => {
            setDraft(filters);
            setFilterOpen(true);
          }}
          style={[styles.toolBtn, activeCount > 0 && styles.toolOn]}
          accessibilityLabel="Filters"
        >
          <Icon name="browse" size={16} color={activeCount ? colors.accent : '#fff'} />
          <Text style={[styles.toolValue, activeCount > 0 && { color: colors.accent }]}>Filters</Text>
          {activeCount ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{activeCount}</Text>
            </View>
          ) : null}
        </PressableScale>
      </View>

      {active.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeRow}>
          {active.map((a) => (
            <Animated.View key={a.key} entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} layout={LinearTransition}>
              <PressableScale
                onPress={() => setFilters((f) => ({ ...f, [a.key]: a.key === 'dub' ? false : '' }))}
                style={styles.activeChip}
                accessibilityLabel={`Remove ${a.text}`}
              >
                <Text style={styles.activeText}>{a.text}</Text>
                <Icon name="x" size={13} color={colors.text} />
              </PressableScale>
            </Animated.View>
          ))}
          <PressableScale onPress={() => setFilters((f) => ({ ...EMPTY, order: f.order }))} style={styles.clearAll}>
            <Text style={styles.clearText}>Clear all</Text>
          </PressableScale>
        </ScrollView>
      ) : (
        <View style={{ height: 6 }} />
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        ref={listRef}
        data={items}
        key={cols}
        numColumns={cols}
        keyExtractor={(a) => a.id}
        renderItem={({ item, index }) => <PosterCard anime={item} index={index % 9} width={cardW} showFacts />}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ gap: 20, paddingBottom: insets.bottom + 100 }}
        ListHeaderComponent={header}
        onEndReachedThreshold={1.5}
        onEndReached={() => {
          if (!loading && hasNext && !error) load(page + 1, generation.current);
        }}
        ListEmptyComponent={
          loading ? (
            <View style={styles.skelGrid}>
              {Array.from({ length: cols * 3 }, (_, i) => (
                <View key={i}>
                  <Skeleton width={cardW} height={cardW * 1.5} rounded={radius.md} />
                  <Skeleton width={cardW * 0.8} height={11} style={{ marginTop: 9 }} />
                </View>
              ))}
            </View>
          ) : error ? (
            <ErrorState message={error} onRetry={() => load(1, generation.current)} />
          ) : (
            <EmptyState icon="search" title="No anime found" text="Try removing a filter." />
          )
        }
        ListFooterComponent={items.length && loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} /> : undefined}
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
      />

      {/* Sort: one tap picks and closes. */}
      <BottomSheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        <View style={{ paddingHorizontal: 8, paddingBottom: 6 }}>
          {SORTS.map((s) => {
            const on = filters.order === s.key;
            return (
              <PressableScale
                key={s.label}
                haptic
                scaleTo={0.98}
                style={[styles.option, on && styles.optionOn]}
                onPress={() => {
                  setFilters((f) => ({ ...f, order: s.key }));
                  setSortOpen(false);
                }}
              >
                <Text style={[styles.optionText, on && { color: colors.accent }]}>{s.label}</Text>
                {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
              </PressableScale>
            );
          })}
        </View>
      </BottomSheet>

      {/* Filters: change several things, then apply once. */}
      <BottomSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        footer={
          <>
            <PressableScale onPress={() => setDraft((d) => ({ ...EMPTY, order: d.order }))} style={styles.resetBtn}>
              <Text style={styles.resetText}>Reset</Text>
            </PressableScale>
            <PressableScale
              haptic
              onPress={() => {
                setFilters(draft);
                setFilterOpen(false);
              }}
              style={styles.applyBtn}
            >
              <Text style={styles.applyText}>Show results</Text>
            </PressableScale>
          </>
        }
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 8 }}>
          <Text style={styles.group}>Language</Text>
          <View style={styles.wrap}>
            <Chip label="Sub & Dub" on={!draft.dub} onPress={() => setDraft((d) => ({ ...d, dub: false }))} />
            <Chip label="English dub only" tone="dub" on={draft.dub} onPress={() => setDraft((d) => ({ ...d, dub: true }))} />
          </View>
          <Text style={styles.group}>Status</Text>
          <View style={styles.wrap}>
            {STATUS.map((s) => (
              <Chip key={s.label} label={s.label} on={draft.status === s.key} onPress={() => setDraft((d) => ({ ...d, status: s.key }))} />
            ))}
          </View>
          <Text style={styles.group}>Format</Text>
          <View style={styles.wrap}>
            {TYPES.map((t) => (
              <Chip key={t.label} label={t.label} on={draft.type === t.key} onPress={() => setDraft((d) => ({ ...d, type: t.key }))} />
            ))}
          </View>
          <Text style={styles.group}>Genre</Text>
          <View style={styles.wrap}>
            <Chip label="All" on={!draft.genre} onPress={() => setDraft((d) => ({ ...d, genre: '' }))} />
            {(genres.data || []).map((g) => (
              <Chip key={g} label={g} on={draft.genre === g} onPress={() => setDraft((d) => ({ ...d, genre: d.genre === g ? '' : g }))} />
            ))}
          </View>
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 28, paddingHorizontal: 16 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, marginHorizontal: 16, marginTop: 14, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surface3 },
  searchText: { color: colors.muted, fontFamily: fonts.bold, fontSize: 15 },
  toolbar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 12 },
  toolBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: radius.md, backgroundColor: colors.surface2 },
  toolOn: { backgroundColor: 'rgba(255,100,10,0.14)' },
  toolLabel: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13 },
  toolValue: { color: '#fff', fontFamily: fonts.black, fontSize: 13.5 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#000', fontFamily: fonts.black, fontSize: 11 },
  activeRow: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, alignItems: 'center' },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: 'rgba(255,100,10,0.14)', borderWidth: 1, borderColor: 'rgba(255,100,10,0.45)' },
  activeText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  clearAll: { height: 32, justifyContent: 'center', paddingHorizontal: 6 },
  clearText: { color: colors.muted, fontFamily: fonts.black, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  skelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingTop: 10 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52, paddingHorizontal: 14, borderRadius: radius.md },
  optionOn: { backgroundColor: 'rgba(255,100,10,0.1)' },
  optionText: { color: '#fff', fontFamily: fonts.bold, fontSize: 15.5 },
  group: { color: colors.muted, fontFamily: fonts.black, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 16, marginBottom: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  resetBtn: { flex: 1, height: 48, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  resetText: { color: '#fff', fontFamily: fonts.black, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  applyBtn: { flex: 2, height: 48, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#000', fontFamily: fonts.black, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
});
