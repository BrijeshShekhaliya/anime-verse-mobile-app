import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputInstance } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon, type IconName } from '@/components/Icon';
import { PosterCard } from '@/components/PosterCard';
import { PressableScale } from '@/components/PressableScale';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState, ErrorState } from '@/components/States';
import { api } from '@/lib/api';
import { useLibrary } from '@/lib/library';
import { rankByQuery } from '@/lib/searchRank';
import { colors, fonts, radius } from '@/lib/theme';
import type { Anime } from '@/lib/types';
import { useFetch } from '@/lib/useFetch';

const SORTS: { key: string; label: string; hint: string; icon: IconName }[] = [
  { key: '', label: 'Most popular', hint: 'What most people are watching', icon: 'spark' },
  { key: 'score', label: 'Top rated', hint: 'Highest fan scores first', icon: 'star' },
  { key: 'newest', label: 'Newest', hint: 'Latest releases first', icon: 'clock' },
  { key: 'title', label: 'A–Z', hint: 'Alphabetical by title', icon: 'list' },
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
const GENRES_COLLAPSED = 12;

type Filters = { genre: string; type: string; status: string; order: string; dub: boolean };
const EMPTY: Filters = { genre: '', type: '', status: '', order: '', dub: false };
const labelOf = (list: { key: string; label: string }[], key: string) => list.find((x) => x.key === key)?.label || key;

export default function BrowseScreen() {
  const params = useLocalSearchParams<{ genre?: string; type?: string; status?: string; order?: string; dub?: string; focus?: string; q?: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cols = width >= 700 ? 5 : 3;
  const cardW = Math.floor((width - 32 - (cols - 1) * 12) / cols);
  const lib = useLibrary();

  // ---- Filters (from "View all" links) and the search box ----
  const [filters, setFilters] = useState<Filters>(EMPTY);
  useEffect(() => {
    setFilters({
      genre: params.genre || '',
      type: params.type || '',
      status: params.status || '',
      order: params.order === 'popularity' ? '' : params.order || '',
      dub: params.dub === '1',
    });
  }, [params.genre, params.type, params.status, params.order, params.dub]);

  const inputRef = useRef<TextInputInstance>(null);
  const [text, setText] = useState(params.q || '');
  const [query, setQuery] = useState(params.q || ''); // debounced
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (params.focus === '1') setTimeout(() => inputRef.current?.focus(), 250);
  }, [params.focus]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim().length >= 2 ? text.trim() : ''), 350);
    return () => clearTimeout(t);
  }, [text]);

  // ---- Results ----
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
        const res = await api.search({ ...filters, q: query || undefined, page: p });
        if (gen !== generation.current) return;
        // Titles that contain the search come first (within each page).
        const pageItems = query ? rankByQuery(res.items, query) : res.items;
        setItems((prev) => {
          if (p === 1) return pageItems;
          const seen = new Set(prev.map((a) => a.id));
          return [...prev, ...pageItems.filter((a) => !seen.has(a.id))];
        });
        setHasNext(res.hasNext);
        setPage(p);
      } catch (e) {
        if (gen === generation.current) setError((e as Error).message);
      } finally {
        if (gen === generation.current) setLoading(false);
      }
    },
    [filters, query]
  );

  // New search or filters: start from the top with page 1 only.
  useEffect(() => {
    generation.current += 1;
    setHasNext(true);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    load(1, generation.current);
  }, [load]);

  // ---- Sheets ----
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [allGenres, setAllGenres] = useState(false);
  const genres = useFetch(() => api.genres(), []);

  const activeCount = [filters.genre, filters.type, filters.status, filters.dub ? 'dub' : ''].filter(Boolean).length;
  const active = [
    filters.dub ? { key: 'dub' as const, text: 'English dub' } : null,
    filters.status ? { key: 'status' as const, text: labelOf(STATUS, filters.status) } : null,
    filters.type ? { key: 'type' as const, text: labelOf(TYPES, filters.type) } : null,
    filters.genre ? { key: 'genre' as const, text: filters.genre } : null,
  ].filter(Boolean) as { key: keyof Filters; text: string }[];

  const title = query ? 'Search' : filters.dub ? 'English Dubbed' : filters.genre ? `${filters.genre} Anime` : 'Browse';
  const searching = text.trim().length >= 2 && (text.trim() !== query || loading);

  const header = (
    <View style={{ paddingTop: insets.top + 12 }}>
      <Text style={styles.title}>{title}</Text>

      {/* Search happens right here; results replace the grid below. */}
      <View style={[styles.searchBar, focused && styles.searchFocused]}>
        <Icon name="search" size={18} color={focused ? colors.accent : colors.muted} />
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search anime by title"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          returnKeyType="search"
          onSubmitEditing={() => {
            setQuery(text.trim());
            lib.addSearch(text);
            Keyboard.dismiss();
          }}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searching ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        {text && !searching ? (
          <PressableScale
            onPress={() => {
              setText('');
              setQuery('');
            }}
            hitSlop={10}
            accessibilityLabel="Clear search"
          >
            <Icon name="x" size={18} color={colors.muted} />
          </PressableScale>
        ) : null}
      </View>

      {/* Recent searches while the box is focused and empty. */}
      {focused && !text && lib.searches.length ? (
        <Animated.View entering={FadeIn.duration(160)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.recentRow}>
            {lib.searches.map((s) => (
              <PressableScale key={s} onPress={() => setText(s)} style={styles.recentChip}>
                <Icon name="history" size={13} color={colors.muted} />
                <Text style={styles.recentText}>{s}</Text>
              </PressableScale>
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}

      <View style={styles.toolbar}>
        <PressableScale haptic onPress={() => setSortOpen(true)} style={styles.toolBtn} accessibilityLabel="Sort">
          <Icon name={SORTS.find((s) => s.key === filters.order)?.icon || 'spark'} size={16} color={colors.text2} />
          <Text style={styles.toolValue} numberOfLines={1}>
            {query && !filters.order ? 'Best match' : labelOf(SORTS, filters.order)}
          </Text>
          <Icon name="down" size={15} color={colors.muted} />
        </PressableScale>
        <PressableScale
          haptic
          onPress={() => {
            Keyboard.dismiss();
            setDraft(filters);
            setFilterOpen(true);
          }}
          style={[styles.toolBtn, activeCount > 0 && styles.toolOn]}
          accessibilityLabel="Filters"
        >
          <Icon name="browse" size={16} color={activeCount ? colors.accent : colors.text2} />
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
            <Animated.View key={a.key} entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} layout={LinearTransition.duration(200)}>
              <PressableScale
                onPress={() => setFilters((f) => ({ ...f, [a.key]: a.key === 'dub' ? false : '' }))}
                style={styles.activeChip}
                accessibilityLabel={`Remove ${a.text}`}
              >
                <Text style={styles.activeText}>{a.text}</Text>
                <Icon name="x" size={12} color={colors.text} />
              </PressableScale>
            </Animated.View>
          ))}
          <PressableScale onPress={() => setFilters((f) => ({ ...EMPTY, order: f.order }))} style={styles.clearAll}>
            <Text style={styles.clearText}>Clear all</Text>
          </PressableScale>
        </ScrollView>
      ) : (
        <View style={{ height: 14 }} />
      )}
      {query ? <Text style={styles.resultsFor}>Results for “{query}”</Text> : null}
    </View>
  );

  const genreList = genres.data || [];
  const shownGenres = allGenres ? genreList : genreList.slice(0, GENRES_COLLAPSED);

  return (
    <View style={styles.screen}>
      <FlatList
        ref={listRef}
        data={items}
        key={cols}
        numColumns={cols}
        keyExtractor={(a, i) => `${a.id}-${i}`}
        renderItem={({ item, index }) => <PosterCard anime={item} index={index} width={cardW} showFacts />}
        maxToRenderPerBatch={9}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ gap: 20, paddingBottom: insets.bottom + 100 }}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
            <EmptyState
              icon="search"
              title={query ? `Nothing found for “${query}”` : 'No anime found'}
              text={query ? 'Try the English or Japanese title, or remove a filter.' : 'Try removing a filter.'}
            />
          )
        }
        ListFooterComponent={items.length && loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} /> : undefined}
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      {/* Sort: one tap picks and closes. */}
      <BottomSheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort by" subtitle="Choose how results are ordered">
        <View style={styles.sortList}>
          {SORTS.map((s) => {
            const on = filters.order === s.key;
            return (
              <PressableScale
                key={s.label}
                haptic
                scaleTo={0.98}
                style={[styles.sortRow, on && styles.sortRowOn]}
                onPress={() => {
                  setFilters((f) => ({ ...f, order: s.key }));
                  setSortOpen(false);
                }}
              >
                <View style={[styles.sortIcon, on && styles.sortIconOn]}>
                  <Icon name={s.icon} size={18} color={on ? '#000' : colors.text2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sortLabel, on && { color: colors.accent }]}>{s.label}</Text>
                  <Text style={styles.sortHint}>{s.hint}</Text>
                </View>
                <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
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
        subtitle="Narrow down what you see"
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
              <Text style={styles.applyText}>Apply filters</Text>
            </PressableScale>
          </>
        }
      >
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 10 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.group}>Language</Text>
          <View style={styles.cardRow}>
            {[
              { on: !draft.dub, label: 'Sub & Dub', hint: 'Everything', icon: 'cc' as IconName, set: false },
              { on: draft.dub, label: 'English dub', hint: 'English audio only', icon: 'mic' as IconName, set: true },
            ].map((o) => (
              <PressableScale key={o.label} haptic scaleTo={0.97} onPress={() => setDraft((d) => ({ ...d, dub: o.set }))} style={[styles.choiceCard, o.on && styles.choiceOn]}>
                <Icon name={o.icon} size={20} color={o.on ? colors.accent : colors.text2} />
                <Text style={[styles.choiceLabel, o.on && { color: '#fff' }]}>{o.label}</Text>
                <Text style={styles.choiceHint}>{o.hint}</Text>
              </PressableScale>
            ))}
          </View>

          <Text style={styles.group}>Status</Text>
          <Segmented options={STATUS} value={draft.status} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />

          <Text style={styles.group}>Format</Text>
          <View style={styles.wrap}>
            {TYPES.map((t) => (
              <Pill key={t.label} label={t.label} on={draft.type === t.key} onPress={() => setDraft((d) => ({ ...d, type: t.key }))} />
            ))}
          </View>

          <Text style={styles.group}>Genre</Text>
          <View style={styles.wrap}>
            <Pill label="All" on={!draft.genre} onPress={() => setDraft((d) => ({ ...d, genre: '' }))} />
            {shownGenres.map((g) => (
              <Pill key={g} label={g} on={draft.genre === g} onPress={() => setDraft((d) => ({ ...d, genre: d.genre === g ? '' : g }))} />
            ))}
          </View>
          {genreList.length > GENRES_COLLAPSED ? (
            <PressableScale onPress={() => setAllGenres((v) => !v)} style={styles.moreGenres} hitSlop={6}>
              <Text style={styles.moreGenresText}>{allGenres ? 'Show fewer genres' : `Show all ${genreList.length} genres`}</Text>
              <Icon name="down" size={14} color={colors.accent} />
            </PressableScale>
          ) : null}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

// Segmented control: one connected bar, the selected part highlighted.
function Segmented({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.segment}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <PressableScale key={o.label} haptic scaleTo={0.97} onPress={() => onChange(o.key)} style={[styles.segmentItem, on && styles.segmentOn]}>
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <PressableScale haptic scaleTo={0.95} onPress={onPress} style={[styles.pill, on && styles.pillOn]} accessibilityState={{ selected: on }}>
      {on ? <Icon name="check" size={13} color="#000" /> : null}
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 28, paddingHorizontal: 16 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, marginHorizontal: 16, marginTop: 14, paddingHorizontal: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surface3 },
  searchFocused: { borderColor: colors.accent, backgroundColor: '#18191e' },
  searchInput: { flex: 1, color: '#fff', fontFamily: fonts.bold, fontSize: 15.5, paddingVertical: 0 },
  recentRow: { gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  recentChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.surface2 },
  recentText: { color: colors.text2, fontFamily: fonts.bold, fontSize: 12.5 },
  toolbar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 12 },
  toolBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 42, borderRadius: radius.lg, backgroundColor: colors.surface2, paddingHorizontal: 10 },
  toolOn: { backgroundColor: 'rgba(255,100,10,0.14)' },
  toolValue: { color: '#fff', fontFamily: fonts.black, fontSize: 13.5, flexShrink: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#000', fontFamily: fonts.black, fontSize: 11 },
  activeRow: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, alignItems: 'center' },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(255,100,10,0.14)', borderWidth: 1, borderColor: 'rgba(255,100,10,0.45)' },
  activeText: { color: '#fff', fontFamily: fonts.bold, fontSize: 12.5 },
  clearAll: { height: 30, justifyContent: 'center', paddingHorizontal: 6 },
  clearText: { color: colors.muted, fontFamily: fonts.black, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.5 },
  resultsFor: { color: colors.muted, fontFamily: fonts.bold, fontSize: 13, paddingHorizontal: 16, marginBottom: 12 },
  skelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingTop: 6 },
  // Sort sheet
  sortList: { paddingHorizontal: 12, paddingBottom: 6, gap: 4 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.lg },
  sortRowOn: { backgroundColor: 'rgba(255,100,10,0.09)' },
  sortIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  sortIconOn: { backgroundColor: colors.accent },
  sortLabel: { color: '#fff', fontFamily: fonts.black, fontSize: 15.5 },
  sortHint: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  // Filter sheet
  group: { color: colors.muted, fontFamily: fonts.black, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 18, marginBottom: 10 },
  cardRow: { flexDirection: 'row', gap: 10 },
  choiceCard: { flex: 1, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface2, borderWidth: 1.5, borderColor: 'transparent', gap: 6 },
  choiceOn: { borderColor: colors.accent, backgroundColor: 'rgba(255,100,10,0.08)' },
  choiceLabel: { color: colors.text2, fontFamily: fonts.black, fontSize: 14.5 },
  choiceHint: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
  segment: { flexDirection: 'row', padding: 4, borderRadius: radius.lg, backgroundColor: colors.surface2 },
  segmentItem: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accent },
  segmentText: { color: colors.text2, fontFamily: fonts.bold, fontSize: 13 },
  segmentTextOn: { color: '#000', fontFamily: fonts.black },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.surface2 },
  pillOn: { backgroundColor: colors.accent },
  pillText: { color: colors.text2, fontFamily: fonts.bold, fontSize: 13 },
  pillTextOn: { color: '#000', fontFamily: fonts.black },
  moreGenres: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 12 },
  moreGenresText: { color: colors.accent, fontFamily: fonts.black, fontSize: 12.5 },
  resetBtn: { flex: 1, height: 50, borderRadius: radius.lg, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  resetText: { color: '#fff', fontFamily: fonts.black, fontSize: 14 },
  applyBtn: { flex: 2, height: 50, borderRadius: radius.lg, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: '#000', fontFamily: fonts.black, fontSize: 14.5 },
});
