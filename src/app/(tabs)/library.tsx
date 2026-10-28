import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
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

const TABS = ['Continue', 'My List', 'History'] as const;
type Tab = (typeof TABS)[number];

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const lib = useLibrary();
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

  const confirmClear = () => {
    if (Platform.OS === 'web') {
      lib.clearHistory();
      return;
    }
    Alert.alert('Clear history?', 'This removes every title you have viewed.', [
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
        <FlatList
          data={lib.continueWatching}
          keyExtractor={(p) => p.anime.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <EmptyState icon="history" title="Nothing in progress" text="Open any anime and tap “Mark episode watched” to track where you are." action="Browse anime" onAction={() => router.push('/browse')} />
          }
          renderItem={({ item, index }) => (
            <Animated.View exiting={FadeOut} layout={LinearTransition.springify()} style={{ marginBottom: 18 }}>
              <ContinueCard item={item} index={index} width={width - 32} />
              <PressableScale onPress={() => lib.clearProgress(item.anime.id)} style={styles.removeChip} hitSlop={8} accessibilityLabel="Remove from Continue Watching">
                <Icon name="x" size={16} color="#fff" />
              </PressableScale>
            </Animated.View>
          )}
        />
      )}

      {tab === 'My List' && (
        <FlatList
          key={`list-${cols}`}
          data={lib.list}
          numColumns={cols}
          keyExtractor={(l) => l.anime.id}
          columnWrapperStyle={lib.list.length ? { gap: 12 } : undefined}
          contentContainerStyle={[styles.list, { gap: 20 }]}
          ListEmptyComponent={<EmptyState icon="bookmark" title="Your list is empty" text="Tap the bookmark on any anime to save it here." action="Find something" onAction={() => router.push('/browse')} />}
          renderItem={({ item, index }) => <PosterCard anime={item.anime as Anime} index={index % 12} width={cardW} showFacts />}
        />
      )}

      {tab === 'History' && (
        <FlatList
          data={lib.history}
          keyExtractor={(h) => h.anime.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            lib.history.length ? (
              <PressableScale onPress={confirmClear} style={styles.clear} hitSlop={8}>
                <Icon name="trash" size={15} color={colors.muted} />
                <Text style={styles.clearText}>Clear history</Text>
              </PressableScale>
            ) : undefined
          }
          ListEmptyComponent={<EmptyState icon="history" title="No history yet" text="Titles you open will show up here." />}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 10) * 30)} exiting={FadeOut} layout={LinearTransition.springify()}>
              <PressableScale onPress={() => router.push(`/anime/${item.anime.id}`)} style={styles.historyRow}>
                {item.anime.image ? <Image source={{ uri: item.anime.image }} style={styles.thumb} contentFit="cover" transition={200} /> : <View style={styles.thumb} />}
                <View style={{ flex: 1 }}>
                  <Text style={styles.histTitle} numberOfLines={2}>
                    {item.anime.title}
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
  removeChip: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  clear: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginBottom: 12 },
  clearText: { color: colors.muted, fontFamily: fonts.black, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  thumb: { width: 52, height: 74, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  histTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  histMeta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 4 },
  rowX: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
