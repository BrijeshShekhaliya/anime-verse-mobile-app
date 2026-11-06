import { Image } from 'expo-image';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { airDateLabel } from '@/lib/airDate';
import { colors, fonts } from '@/lib/theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

// One episode: its picture with a play button and length, then its name and date. The anime
// page's list and the watch screen's Up Next both draw this, so they always look the same.
export const EpisodeCard = memo(function EpisodeCard({
  number,
  name,
  thumb,
  runtime,
  airingAt,
  upcoming: markedUpcoming,
  thumbW,
  onPress,
}: {
  number: number;
  name: string;
  thumb?: string | null;
  runtime?: number | null;
  airingAt?: number | null;
  upcoming?: boolean;
  thumbW: number;
  onPress: () => void;
}) {
  const date = airingAt ? new Date(airingAt * 1000) : null;
  // Not out yet: shown with a lock and its date, and can't be opened.
  const upcoming = !!markedUpcoming || (!!date && date.getTime() > Date.now());
  return (
    <PressableScale
      onPress={onPress}
      disabled={upcoming}
      style={[styles.row, upcoming && { opacity: 0.75 }]}
      scaleTo={0.98}
      accessibilityLabel={upcoming ? `Episode ${number}, coming soon, ${airDateLabel(airingAt)}` : `Episode ${number}, ${name}`}
    >
      <View style={[styles.thumb, { width: thumbW, height: Math.round(thumbW * 0.5625) }]}>
        {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} cachePolicy="memory-disk" /> : null}
        {upcoming ? (
          <View style={styles.locked}>
            <Icon name="lock" size={18} color="#fff" />
            <Text style={styles.lockedText}>COMING SOON</Text>
          </View>
        ) : (
          <View style={styles.play}>
            <Icon name="play" size={16} color="#fff" />
          </View>
        )}
        {runtime ? (
          <View style={styles.duration}>
            <Text style={styles.durationText}>{runtime}m</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, paddingTop: 2 }}>
        <Text style={styles.title} numberOfLines={3}>
          {/* "4. The Door to Hell"; just "Episode 4" when there's no name for it. */}
          {name === `Episode ${number}` ? name : `${number}. ${name}`}
        </Text>
        {upcoming ? (
          <Text style={[styles.meta, { color: colors.accent }]}>Coming {airDateLabel(airingAt)}</Text>
        ) : date ? (
          <Text style={styles.meta}>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
        ) : null}
      </View>
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14 },
  thumb: { borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface2 },
  play: { position: 'absolute', top: '50%', left: '50%', marginTop: -18, marginLeft: -18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  duration: { position: 'absolute', right: 5, bottom: 5, paddingHorizontal: 6, height: 19, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center' },
  durationText: { color: '#fff', fontFamily: fonts.regular, fontSize: 12 },
  title: { color: '#fff', fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 21 },
  meta: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 6 },
  locked: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)' },
  lockedText: { color: '#fff', fontFamily: fonts.black, fontSize: 10, letterSpacing: 1.2 },
});
