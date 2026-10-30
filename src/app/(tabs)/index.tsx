import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONTINUE_CARD_W, ContinueCard } from '@/components/ContinueCard';
import { Hero } from '@/components/Hero';
import { Row, SECTION_GAP, SectionHeader } from '@/components/Row';
import { RowSkeleton, Skeleton } from '@/components/Skeleton';
import { ErrorState } from '@/components/States';
import { TopBar } from '@/components/TopBar';
import { useLibrary } from '@/lib/library';
import { cap } from '@/lib/format';
import { colors } from '@/lib/theme';
import { useHome } from '@/lib/queries';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const { data, error, isPending, refetch } = useHome();
  const loading = isPending;
  const { continueWatching } = useLibrary();
  const [refreshing, setRefreshing] = useState(false);

  // Popular titles with an English dub, like the website's "Dubbed" row.
  const dubbed = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    return [...data.popular, ...data.topRated].filter((a) => a.languages?.dub && !seen.has(a.id) && seen.add(a.id));
  }, [data]);

  const season = data?.seasonNow?.[0];

  // The top slider keeps the titles it opened with for this session, so a
  // background refresh never swaps slides while someone is looking at them.
  // New picks show on the next launch (or after pull-to-refresh).
  const spotlightRef = useRef(data?.spotlight);
  if (!spotlightRef.current?.length && data?.spotlight?.length) spotlightRef.current = data.spotlight;
  const spotlight = spotlightRef.current || [];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopBar scrollY={scrollY} solidAfter={260} />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        refreshControl={
          <RefreshControl
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressViewOffset={insets.top + 50}
            refreshing={refreshing}
            onRefresh={() => {
              // Pull-to-refresh always asks AniList; the spinner stays until it answers.
              setRefreshing(true);
              refetch()
                .then((r) => {
                  if (r.data?.spotlight?.length) spotlightRef.current = r.data.spotlight;
                })
                .finally(() => setRefreshing(false));
            }}
          />
        }
      >
        {loading && !data ? (
          <View>
            <Skeleton width="100%" height={520} rounded={0} />
            <View style={{ height: 24 }} />
            <RowSkeleton />
            <RowSkeleton />
          </View>
        ) : error && !data ? (
          <View style={{ paddingTop: insets.top + 80 }}>
            <ErrorState message={error.message || 'Something went wrong'} onRetry={() => refetch()} />
          </View>
        ) : data ? (
          <>
            <Hero items={spotlight} />
            <View style={{ marginTop: 8 }}>
              {continueWatching.length > 0 && (
                <View style={{ marginBottom: SECTION_GAP }}>
                  <SectionHeader
                    title="Continue Watching"
                    onMore={() => router.push('/library')}
                  />
                  <FlatList
                    horizontal
                    data={continueWatching}
                    keyExtractor={(p) => p.anime.id}
                    renderItem={({ item, index }) => <ContinueCard item={item} index={index} />}
                    contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                    showsHorizontalScrollIndicator={false}
                    // Glides card to card instead of stopping half-way.
                    snapToInterval={CONTINUE_CARD_W + 12}
                    snapToAlignment="start"
                    decelerationRate="fast"
                  />
                </View>
              )}
              <Row title="Top 10 Airing Right Now" items={data.trending} ranked more="/browse?status=airing&order=popularity" />
              <Row
                title={season?.season ? `${cap(season.season)} ${season.year ?? ''} Season` : 'This Season'}
                items={data.seasonNow}
                more="/browse?status=airing"
              />
              <Row title="Dubbed in English" items={dubbed} more="/browse?dub=1" />
              <Row title="Highest Rated of All Time" items={data.topRated} more="/browse?order=score" />
              <Row title="Most Popular" items={data.popular} more="/browse?order=popularity" />
              <Row title="Coming Next Season" items={data.upcoming} more="/browse?status=upcoming" />
              <Row title="Top Anime Movies" items={data.movies} more="/browse?type=movie&order=score" />
            </View>
          </>
        ) : null}
      </Animated.ScrollView>
    </View>
  );
}
