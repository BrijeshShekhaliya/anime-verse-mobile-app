import { router, type Href } from 'expo-router';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Icon } from './Icon';
import { PosterCard } from './PosterCard';
import { PressableScale } from './PressableScale';
import { colors, fonts } from '@/lib/theme';
import type { Anime } from '@/lib/types';

export function SectionHeader({ title, sub, onMore }: { title: string; sub?: string; onMore?: () => void }) {
  return (
    <View style={styles.head}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      {onMore && (
        <PressableScale onPress={onMore} style={styles.more} hitSlop={10}>
          <Text style={styles.moreText}>View all</Text>
          <Icon name="right" size={14} color={colors.muted} />
        </PressableScale>
      )}
    </View>
  );
}

// A titled, horizontally scrolling row of poster cards.
export function Row({ title, sub, items, more, ranked }: { title: string; sub?: string; items?: Anime[]; more?: Href; ranked?: boolean }) {
  if (!items?.length) return null;
  const data = ranked ? items.slice(0, 10) : items;
  return (
    <Animated.View entering={FadeIn.duration(400)} style={{ marginBottom: 28 }}>
      <SectionHeader title={title} sub={sub} onMore={more ? () => router.push(more) : undefined} />
      <FlatList
        horizontal
        data={data}
        keyExtractor={(a) => a.id}
        renderItem={({ item, index }) => <PosterCard anime={item} index={index} width={ranked ? 136 : 124} rank={ranked ? index + 1 : undefined} />}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={(ranked ? 136 : 124) + 12}
        initialNumToRender={5}
        windowSize={5}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, marginBottom: 12, gap: 12 },
  title: { color: colors.text, fontFamily: fonts.black, fontSize: 19 },
  sub: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 3 },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  moreText: { color: colors.muted, fontFamily: fonts.black, fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase' },
});
