import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { PosterCard } from '@/components/PosterCard';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { api, type SearchParams } from '@/lib/api';
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
  { key: 'airing', label: 'Airing' },
  { key: 'finished', label: 'Finished' },
  { key: 'upcoming', label: 'Upcoming' },
];
const TYPES = [
  { key: 'tv', label: 'TV' },
  { key: 'movie', label: 'Movie' },
  { key: 'ova', label: 'OVA' },
  { key: 'ona', label: 'ONA' },
];

type Filters = Required<Pick<SearchParams, 'genre' | 'type' | 'status' | 'order'>> & { dub: boolean };

export default function BrowseScreen() {
  const params = useLocalSearchParams<{ genre?: string; type?: string; status?: string; order?: string; dub?: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cols = width >= 700 ? 5 : 3;
  const cardW = Math.floor((width - 32 - (cols - 1) * 12) / cols);

  const [filters, setFilters] = useState<Filters>({ genre: '', type: '', status: '', order: '', dub: false });
  // Links like "View all" arrive with filters in the URL.
  useEffect(() => {
    setFilters({ genre: params.genre || '', type: params.type || '', status: params.status || '', order: params.order === 'popularity' ? '' : params.order || '', dub: params.dub === '1' });
  }, [params.genre, params.type, params.status, params.order, params.dub]);

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
        // A series can turn up again on a later page; show it once.
        setItems((prev) => {
          const seen = new Set(prev.map((a) => a.id));
          return [...(p === 1 ? [] : prev), ...res.items.filter((a) => !seen.has(a.id) || p === 1)];
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

  // New filters start from the top with page 1 only.
  useEffect(() => {
    generation.current += 1;
    setItems([]);
    setHasNext(true);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    load(1, generation.current);
  }, [load]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const title = filters.dub ? 'English Dubbed' : filters.genre ? `${filters.genre} Anime` : 'Browse';

  const header = (
    <View style={{ paddingTop: insets.top + 12 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        <PressableScale haptic onPress={() => router.push('/search')} style={styles.searchBtn} accessibilityLabel="Search">
          <Icon name="search" size={20} color="#fff" />
        </PressableScale>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {SORTS.map((s) => (
          <Chip key={s.label} label={s.label} on={filters.order === s.key} onPress={() => set({ order: s.key })} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="English dub" tone="dub" on={filters.dub} onPress={() => set({ dub: !filters.dub })} />
        {STATUS.map((s) => (
          <Chip key={s.key} label={s.label} on={filters.status === s.key} onPress={() => set({ status: filters.status === s.key ? '' : s.key })} />
        ))}
        {TYPES.map((t) => (
          <Chip key={t.key} label={t.label} on={filters.type === t.key} onPress={() => set({ type: filters.type === t.key ? '' : t.key })} />
        ))}
      </ScrollView>
      {genres.data?.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingBottom: 16 }]}>
          <Chip label="All genres" on={!filters.genre} onPress={() => set({ genre: '' })} />
          {genres.data.map((g) => (
            <Chip key={g} label={g} on={filters.genre === g} onPress={() => set({ genre: filters.genre === g ? '' : g })} />
          ))}
        </ScrollView>
      ) : (
        <View style={{ height: 16 }} />
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
        renderItem={({ item, index }) => <PosterCard anime={item} index={index % 12} width={cardW} showFacts />}
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
            <EmptyState icon="search" title="No anime found" text="Try loosening the filters." />
          )
        }
        ListFooterComponent={items.length && loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} /> : undefined}
        initialNumToRender={12}
        windowSize={7}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 14 },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 28 },
  searchBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  skelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16 },
});
