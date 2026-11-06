import { Image } from 'expo-image';
import { nav } from '@/lib/nav';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContinueCard } from '@/components/ContinueCard';
import { Icon } from '@/components/Icon';
import { PosterCard } from '@/components/PosterCard';
import { PressableScale } from '@/components/PressableScale';
import { EmptyState } from '@/components/States';
import { useLibrary } from '@/lib/library';
import { timeAgo } from '@/lib/format';
import { colors, fonts, radius, springs } from '@/lib/theme';
import type { Anime } from '@/lib/types';
import { thumbOf, useArt } from '@/lib/artwork';
import { displayTitle, useSettings } from '@/lib/settings';

// A removed card fades away, then the others slide into its place.
const MOVE = LinearTransition.duration(280).easing(Easing.out(Easing.cubic));
const LEAVE = FadeOut.duration(160);
const GRID_PAGE = 24;

const TABS = ['Continue', 'My List', 'History'] as const;
type Tab = (typeof TABS)[number];

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const lib = useLibrary();
  const { titleLang } = useSettings();
  const [tab, setTab] = useState<Tab>(lib.continueWatching.length ? 'Continue' : 'My List');

  const segW = (width - 32) / TABS.length;
  const x = useSharedValue(TABS.indexOf(tab) * segW);
  useEffect(() => {
    x.value = withSpring(TABS.indexOf(tab) * segW, springs.soft);
  }, [tab, segW, x]);
  const underline = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const counts: Record<Tab, number> = { Continue: lib.continueWatching.length, 'My List': lib.list.length, History: lib.history.length };
  const cols = width >= 700 ? 5 : 3;
  const cardW = Math.floor((width - 32 - (cols - 1) * 12) / cols);
  // Continue: two cards a row on phones (three on tablets).
  const contCols = width >= 700 ? 3 : 2;
  const contW = Math.floor((width - 32 - (contCols - 1) * 12) / contCols);

  const confirmClear = () => {
    if (Platform.OS === 'web') {
      lib.clearHistory();
      return;
    }
    Alert.alert('Clear history?', 'This removes every title you have watched.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: lib.clearHistory },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16 }}>
        <Text style={styles.title}>My List</Text>
        <View style={styles.segments}>
          {TABS.map((t) => (
            <PressableScale key={t} haptic onPress={() => setTab(t)} style={[styles.segment, { width: segW }]} accessibilityState={{ selected: tab === t }}>
              <Text style={[styles.segText, tab === t && styles.segOn]}>
                {t}
                {counts[t] ? <Text style={styles.count}>  {counts[t]}</Text> : null}
              </Text>
            </PressableScale>
          ))}
          <Animated.View style={[styles.underline, { width: segW }, underline]} />
        </View>
      </View>

      {tab === 'Continue' && (
        <AnimatedList
          items={lib.continueWatching}
          keyOf={(p) => p.anime.id}
          rowGap={18}
          columnGap={12}
          empty={
            <EmptyState icon="history" title="Nothing in progress" text="Start watching any anime and you can pick it up again here." action="Browse anime" onAction={() => nav.push('/browse')} />
          }
          renderItem={(item, index) => (
            <>
              <ContinueCard item={item} index={index} width={contW} compact />
              <PressableScale onPress={() => lib.clearProgress(item.anime.id)} style={styles.removeChip} hitSlop={10} accessibilityLabel="Remove from Continue Watching">
                <Icon name="x" size={13} color="#fff" />
              </PressableScale>
            </>
          )}
        />
      )}

      {tab === 'My List' && (
        <AnimatedList
          items={lib.list}
          keyOf={(l) => l.anime.id}
          rowGap={20}
          columnGap={12}
          empty={<EmptyState icon="bookmark" title="Your list is empty" text="Tap the bookmark on any anime to save it here." action="Find something" onAction={() => nav.push('/browse')} />}
          renderItem={(item, index) => (
            <>
              <PosterCard anime={item.anime as Anime} index={index % 12} width={cardW} showFacts />
              <PressableScale onPress={() => lib.toggleList(item.anime as Anime)} style={styles.removeChip} hitSlop={10} accessibilityLabel="Remove from My List">
                <Icon name="x" size={13} color="#fff" />
              </PressableScale>
            </>
          )}
        />
      )}

      {tab === 'History' && (
        <AnimatedList
          items={lib.history}
          keyOf={(h) => h.anime.id}
          fullWidth
          header={
            lib.history.length ? (
              <PressableScale onPress={confirmClear} style={styles.clear} hitSlop={8}>
                <Icon name="trash" size={15} color={colors.muted} />
                <Text style={styles.clearText}>Clear history</Text>
              </PressableScale>
            ) : undefined
          }
          empty={<EmptyState icon="history" title="No history yet" text="Anime you watch will show up here." />}
          renderItem={(item, index) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 10) * 30)}>
              <PressableScale onPress={() => nav.push(`/anime/${item.anime.id}`)} style={styles.historyRow}>
                <HistThumb anime={item.anime as Anime} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.histTitle} numberOfLines={2}>
                    {displayTitle(item.anime, titleLang)}
                  </Text>
                  <Text style={styles.histMeta}>
                    {[item.anime.type, item.anime.year].filter(Boolean).join(' · ')}
                    {'  ·  '}
                    {timeAgo(item.at)}
                  </Text>
                </View>
                <PressableScale onPress={() => lib.removeHistory(item.anime.id)} hitSlop={10} style={styles.rowX} accessibilityLabel="Remove from history">
                  <Icon name="x" size={16} color={colors.muted} />
                </PressableScale>
              </PressableScale>
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

// All the cards live in one wrapping container, keyed by title. So removing one touches only
// that one: it fades, and the rest slide along (up a row when needed). A list split into rows
// rebuilds every row after it, which replays their entrance and looks like a page reload.
function AnimatedList<T>({
  items,
  keyOf,
  renderItem,
  empty,
  header,
  rowGap = 0,
  columnGap = 0,
  fullWidth = false,
}: {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  empty: ReactElement;
  header?: ReactElement;
  rowGap?: number;
  columnGap?: number;
  fullWidth?: boolean;
}) {
  // A long list adds cards as they're reached, so opening it never loads every picture.
  const [limit, setLimit] = useState(GRID_PAGE);
  const reduce = useReducedMotion();
  const leaving = reduce ? undefined : LEAVE;
  return (
    <ScrollView
      contentContainerStyle={styles.list}
      scrollEventThrottle={100}
      onScroll={(e) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        if (contentOffset.y + layoutMeasurement.height > contentSize.height - 500 && limit < items.length) setLimit((n) => n + GRID_PAGE);
      }}
    >
      {header}
      {items.length ? (
        <View style={[styles.grid, { rowGap, columnGap }]}>
          {items.slice(0, limit).map((item, index) => (
            <Animated.View key={keyOf(item)} exiting={leaving} layout={reduce ? undefined : MOVE} style={fullWidth ? styles.fullWidth : undefined}>
              {renderItem(item, index)}
            </Animated.View>
          ))}
        </View>
      ) : (
        empty
      )}
    </ScrollView>
  );
}

// History poster: TMDB art when known, else the saved AniList cover.
function HistThumb({ anime }: { anime: Anime }) {
  const { art, settled } = useArt(anime);
  const uri = settled ? thumbOf(anime, art) : undefined;
  return uri ? <Image source={{ uri }} style={styles.thumb} contentFit="cover" transition={200} cachePolicy="memory-disk" /> : <View style={styles.thumb} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 28 },
  segments: { flexDirection: 'row', marginTop: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  segment: { height: 42, alignItems: 'center', justifyContent: 'center' },
  segText: { color: colors.muted, fontFamily: fonts.black, fontSize: 14 },
  segOn: { color: '#fff' },
  count: { color: colors.accent, fontFamily: fonts.black, fontSize: 12 },
  underline: { position: 'absolute', bottom: -1, left: 0, height: 3, borderRadius: 2, backgroundColor: colors.accent },
  list: { padding: 16, paddingBottom: 120 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  fullWidth: { width: '100%' },
  removeChip: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginBottom: 12 },
  clearText: { color: colors.muted, fontFamily: fonts.black, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  thumb: { width: 52, height: 74, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  histTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  histMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 4 },
  rowX: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
