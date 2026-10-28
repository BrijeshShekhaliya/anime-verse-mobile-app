import { StyleSheet, Text } from 'react-native';
import { PressableScale } from './PressableScale';
import { colors, fonts, radius } from '@/lib/theme';

export function Chip({ label, on, onPress, tone = 'accent' }: { label: string; on?: boolean; onPress: () => void; tone?: 'accent' | 'dub' }) {
  const onColor = tone === 'dub' ? colors.dub : colors.accent;
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[styles.chip, on && { backgroundColor: tone === 'dub' ? 'rgba(42,189,187,0.16)' : onColor, borderColor: onColor }]}
    >
      <Text style={[styles.text, on && { color: tone === 'dub' ? colors.dub : '#000' }]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.surface3, backgroundColor: colors.surface, justifyContent: 'center' },
  text: { color: colors.text2, fontFamily: fonts.bold, fontSize: 13 },
});
