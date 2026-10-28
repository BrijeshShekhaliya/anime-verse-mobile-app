import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LangBadges, Score } from '@/components/Badges';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { EmptyState } from '@/components/States';
import { api } from '@/lib/api';
import { factsOf } from '@/lib/format';
import { useLibrary } from '@/lib/library';
import { rankByQuery } from '@/lib/searchRank';
import { colors, fonts, radius } from '@/lib/theme';
import type { Anime } from '@/lib/types';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const lib = useLibrary();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Anime[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [trending, setTrending] = useState<Anime[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    api.home().then((h) => setTrending(h.trending.slice(0, 8))).catch(() => {});
  }, []);

  // Search as you type (debounced). Results from an older query are ignored.
  useEffect(() => {
    const term = q.trim();
    const mine = ++seq.current;
    if (term.length < 2) {
      setResults(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      api
        .search({ q: term })
        .then((r) => mine === seq.current && setResults(rankByQuery(r.items, term)))
        .catch(() => mine === seq.current && setResults([]))
        .finally(() => mine === seq.current && setBusy(false));
    }, 320);
    return () => clearTimeout(t);
  }, [q]);

  const open = (a: Anime) => {
    if (q.trim()) lib.addSearch(q);
    Keyboard.dismiss();
    router.push(`/anime/${a.id}`);
  };

  const showing = results ?? null;
  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.bar}>
        <PressableScale onPress={() => router.back()} style={styles.back} accessibilityLabel="Close search" hitSlop={8}>
          <Icon name="left" size={22} color="#fff" />
        </PressableScale>
        <View style={styles.inputWrap}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            autoFocus
            placeholder="Search anime: English or Japanese title"
            placeholderTextColor={colors.muted}
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={() => lib.addSearch(q)}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          {q && !busy ? (
            <PressableScale onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear">
              <Icon name="x" size={18} color={colors.muted} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      {showing === null ? (
        <FlatList
          data={trending}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={
            <View>
              {lib.searches.length ? (
                <Animated.View entering={FadeIn} style={{ marginBottom: 18 }}>
                  <View style={styles.groupHead}>
                    <Text style={styles.groupTitle}>Recent searches</Text>
                    <PressableScale onPress={lib.clearSearches} hitSlop={8}>
                      <Text style={styles.link}>Clear</Text>
                    </PressableScale>
                  </View>
                  <View style={styles.recent}>
                    {lib.searches.map((s) => (
                      <Chip key={s} label={s} onPress={() => setQ(s)} />
                    ))}
                  </View>
                </Animated.View>
              ) : null}
              {trending.length ? <Text style={[styles.groupTitle, { paddingHorizontal: 16, marginBottom: 6 }]}>Trending now</Text> : null}
            </View>
          }
          renderItem={({ item, index }) => <ResultRow anime={item} index={index} onPress={() => open(item)} />}
        />
      ) : (
        <FlatList
          data={showing}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={showing.length ? <Text style={[styles.groupTitle, { paddingHorizontal: 16, marginBottom: 6 }]}>Top matches</Text> : undefined}
          ListEmptyComponent={!busy ? <EmptyState icon="search" title={`No anime found for “${q.trim()}”`} text="Try the English or Japanese title, or fewer words." /> : undefined}
          renderItem={({ item, index }) => <ResultRow anime={item} index={index} onPress={() => open(item)} query={q.trim()} />}
        />
      )}
    </View>
  );
}

// Highlights the part of the title that matches what was typed.
function Highlight({ text, query }: { text: string; query?: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (!query || i < 0) return <Text style={styles.rowTitle} numberOfLines={2}>{text}</Text>;
  return (
    <Text style={styles.rowTitle} numberOfLines={2}>
      {text.slice(0, i)}
      <Text style={{ color: colors.accent }}>{text.slice(i, i + query.length)}</Text>
      {text.slice(i + query.length)}
    </Text>
  );
}

function ResultRow({ anime, index, onPress, query }: { anime: Anime; index: number; onPress: () => void; query?: string }) {
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 10) * 30).duration(280)}>
      <PressableScale onPress={onPress} style={styles.row} scaleTo={0.98}>
        {anime.image ? <Image source={{ uri: anime.image }} style={styles.thumb} contentFit="cover" transition={200} /> : <View style={styles.thumb} />}
        <View style={{ flex: 1 }}>
          <Highlight text={anime.title} query={query} />
          <View style={styles.meta}>
            <Score value={anime.score} size={12} />
            <LangBadges anime={anime} />
          </View>
          <Text style={styles.facts} numberOfLines={1}>
            {factsOf(anime).join(' · ')}
          </Text>
        </View>
        <Icon name="right" size={16} color={colors.muted} />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surface3, paddingHorizontal: 12 },
  input: { flex: 1, color: '#fff', fontFamily: fonts.bold, fontSize: 15.5, paddingVertical: 0 },
  groupHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 10 },
  groupTitle: { color: colors.muted, fontFamily: fonts.black, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  link: { color: colors.muted, fontFamily: fonts.black, fontSize: 12, textTransform: 'uppercase' },
  recent: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 },
  thumb: { width: 50, height: 72, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  rowTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  facts: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
});
