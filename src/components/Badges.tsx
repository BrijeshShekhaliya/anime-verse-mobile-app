import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { colors, fonts } from '@/lib/theme';
import { dubOf, useDubs } from '@/lib/dubs';
import type { Anime } from '@/lib/types';

// SUB / DUB chips, same colours as the website.
// Dub from the MAL-Dubs list (live), so saved cards update once it loads.
export function LangBadges({ anime, size = 'sm' }: { anime: Pick<Anime, 'languages' | 'id'> & { malId?: number | null }; size?: 'sm' | 'md' }) {
  useDubs();
  const l = { sub: anime.languages?.sub, dub: dubOf(anime) ?? anime.languages?.dub ?? null };
  const big = size === 'md';
  return (
    <View style={styles.row}>
      {l?.sub !== false && (
        <Text style={[styles.chip, big && styles.big, { color: colors.sub, backgroundColor: 'rgba(167,167,255,0.14)' }]}>SUB</Text>
      )}
      {l?.dub === 'full' && <Text style={[styles.chip, big && styles.big, { color: colors.dub, backgroundColor: 'rgba(42,189,187,0.14)' }]}>DUB</Text>}
      {l?.dub === 'partial' && (
        <Text style={[styles.chip, big && styles.big, { color: colors.star, backgroundColor: 'rgba(255,193,46,0.14)' }]}>DUB*</Text>
      )}
    </View>
  );
}

export function EpisodeBadges({ hasSub, hasDub }: { hasSub?: boolean; hasDub?: boolean }) {
  return (
    <View style={styles.row}>
      {hasSub !== false && (
        <Text style={[styles.chip, { color: colors.sub, backgroundColor: 'rgba(167,167,255,0.14)' }]}>SUB</Text>
      )}
      {hasDub && (
        <Text style={[styles.chip, { color: colors.dub, backgroundColor: 'rgba(42,189,187,0.14)' }]}>DUB</Text>
      )}
    </View>
  );
}

export function Score({ value, size = 13 }: { value?: number | null; size?: number }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Icon name="star" size={size + 1} color={colors.star} />
      <Text style={[styles.score, { fontSize: size }]}>{value.toFixed(1)}</Text>
    </View>
  );
}

export function Pill({ label, tone = 'dark' }: { label: string; tone?: 'dark' | 'accent' }) {
  return <Text style={[styles.pill, tone === 'accent' && styles.pillAccent]}>{label}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chip: { fontFamily: fonts.black, fontSize: 10, letterSpacing: 0.4, paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4, overflow: 'hidden' },
  big: { fontSize: 11.5, paddingHorizontal: 7, paddingVertical: 2.5 },
  score: { fontFamily: fonts.black, color: colors.text },
  pill: {
    fontFamily: fonts.black,
    fontSize: 10.5,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
    overflow: 'hidden',
  },
  pillAccent: { backgroundColor: colors.accent, color: '#000' },
});
