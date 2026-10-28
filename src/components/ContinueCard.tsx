import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { PressableScale } from './PressableScale';
import type { Progress } from '@/lib/library';
import { colors, fonts, radius } from '@/lib/theme';

// Landscape card for "Continue Watching": artwork, how far you are, and the
// next episode. Opens the title page, where "Continue on …" links out.
export function ContinueCard({ item, index = 0, width = 260 }: { item: Progress; index?: number; width?: number }) {
  const a = item.anime;
  const art = a.backdrop || a.banner || a.image || undefined;
  const pct = item.total ? Math.min(1, item.episode / item.total) : 0;
  const nextEp = item.total && item.episode >= item.total ? item.episode : item.episode + 1;
  return (
    <Animated.View entering={FadeInRight.delay(Math.min(index, 6) * 60).duration(380)} style={{ width }}>
      <PressableScale onPress={() => router.push(`/watch/${a.id}?ep=${nextEp}` as any)} accessibilityLabel={`Continue ${a.title}`}>
        <View style={[styles.art, { height: width * 0.56 }]}>
          {art && <Image source={{ uri: art }} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} cachePolicy="memory-disk" />}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={StyleSheet.absoluteFill} />
          <View style={styles.overlay}>
            <Text style={styles.next}>
              {item.total && item.episode >= item.total ? 'Finished' : `Next: Episode ${item.episode + 1}`}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(pct * 100, 3)}%` }]} />
          </View>
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {a.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {item.total ? `${item.episode} of ${item.total} watched` : `${item.episode} watched`}
          {item.watchName ? ` · ${item.watchName}` : ''}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface2, justifyContent: 'flex-end' },
  overlay: { paddingHorizontal: 12, paddingBottom: 12 },
  next: { color: '#fff', fontFamily: fonts.black, fontSize: 14 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  fill: { height: '100%', backgroundColor: colors.accent },
  title: { marginTop: 8, color: colors.text, fontFamily: fonts.bold, fontSize: 14 },
  meta: { marginTop: 2, color: colors.muted, fontFamily: fonts.regular, fontSize: 12 },
});
