import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { useSettings, type Settings } from '@/lib/settings';
import { colors, fonts, radius } from '@/lib/theme';

const TITLE_OPTIONS: { key: Settings['titleLang']; label: string; example: string }[] = [
  { key: 'english', label: 'English', example: 'Attack on Titan' },
  { key: 'romaji', label: 'Romaji', example: 'Shingeki no Kyojin' },
];

const AUDIO_OPTIONS: { key: Settings['audioLang']; label: string; hint: string }[] = [
  { key: 'japanese', label: 'Japanese', hint: 'Original audio' },
  { key: 'english', label: 'English', hint: 'English dub' },
  { key: 'hindi', label: 'Hindi', hint: 'Hindi dub' },
];

const QUALITY_OPTIONS: { key: Settings['quality']; label: string; hint: string }[] = [
  { key: 'saver', label: 'Data saver', hint: 'Uses the least mobile data' },
  { key: 'medium', label: 'Medium', hint: 'Balance of picture and data' },
  { key: 'highest', label: 'Highest', hint: 'Best picture, uses more data' },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const s = useSettings();

  // The control follows the tap at once; the app catches up in the background.
  const [titleLang, setTitleLang] = useState(s.titleLang);
  useEffect(() => setTitleLang(s.titleLang), [s.titleLang]);
  const chooseTitleLang = (v: Settings['titleLang']) => {
    setTitleLang(v);
    s.update({ titleLang: v });
  };
  const [audioLang, setAudioLang] = useState(s.audioLang);
  useEffect(() => setAudioLang(s.audioLang), [s.audioLang]);
  const chooseAudioLang = (v: Settings['audioLang']) => {
    setAudioLang(v);
    s.update({ audioLang: v });
  };
  const [quality, setQuality] = useState(s.quality);
  useEffect(() => setQuality(s.quality), [s.quality]);
  const chooseQuality = (v: Settings['quality']) => {
    setQuality(v);
    s.update({ quality: v });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={styles.back} hitSlop={8} accessibilityLabel="Back">
          <Icon name="left" size={22} color="#fff" />
        </PressableScale>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 26 }}>
        <Section title="Display">
          <View style={styles.row}>
            <GradientTile colors={['#8B5CF6', '#3B82F6']}>
              <Text style={styles.glyph}>Aあ</Text>
            </GradientTile>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Title language</Text>
              <Text style={styles.rowHint} numberOfLines={1}>
                {TITLE_OPTIONS.find((o) => o.key === titleLang)?.example}
              </Text>
            </View>
          </View>
          <View style={styles.segWrap}>
            <Segmented value={titleLang} options={TITLE_OPTIONS} onChange={chooseTitleLang} />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <GradientTile colors={['#FF7A18', '#FF3D7F']}>
              <Icon name="mic" size={19} color="#fff" />
            </GradientTile>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Preferred audio language</Text>
              <Text style={styles.rowHint} numberOfLines={1}>
                {AUDIO_OPTIONS.find((o) => o.key === audioLang)?.hint}
              </Text>
            </View>
          </View>
          <View style={styles.segWrap}>
            <Segmented value={audioLang} options={AUDIO_OPTIONS} onChange={chooseAudioLang} />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <GradientTile colors={['#10B981', '#06B6D4']}>
              <Text style={styles.glyph}>HD</Text>
            </GradientTile>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Preferred streaming quality</Text>
              <Text style={styles.rowHint} numberOfLines={1}>
                {QUALITY_OPTIONS.find((o) => o.key === quality)?.hint}
              </Text>
            </View>
          </View>
          <View style={styles.segWrap}>
            <Segmented value={quality} options={QUALITY_OPTIONS} onChange={chooseQuality} />
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Animated.View entering={FadeInDown.duration(380)}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <View style={styles.card}>{children}</View>
    </Animated.View>
  );
}

// Colourful icon tile (gradient), like the iOS/Android settings apps.
function GradientTile({ colors: c, children }: { colors: [string, string]; children: ReactNode }) {
  return (
    <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
      {children}
    </LinearGradient>
  );
}

// Segmented control with a pill that slides to the chosen option (transform
// only, so it stays smooth even while the app updates behind it).
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  const [w, setW] = useState(0);
  const seg = w / options.length;
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withTiming(index * seg, { duration: 220, easing: Easing.bezier(0.2, 0.9, 0.25, 1) });
  }, [index, seg, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.seg} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width - 6)}>
      {w > 0 ? <Animated.View style={[styles.segPill, { width: seg }, pill]} /> : null}
      {options.map((o) => {
        const on = o.key === value;
        return (
          <PressableScale key={o.key} haptic onPress={() => onChange(o.key)} style={styles.segBtn} scaleTo={0.97} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  headerTitle: { color: '#fff', fontFamily: fonts.black, fontSize: 18 },
  sectionTitle: { color: colors.muted, fontFamily: fonts.black, fontSize: 11.5, letterSpacing: 1.4, marginBottom: 10, marginLeft: 4 },
  card: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', paddingBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12 },
  tile: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  glyph: { color: '#fff', fontFamily: fonts.black, fontSize: 13.5, letterSpacing: -0.3 },
  rowTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 15.5 },
  rowHint: { color: colors.muted, fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
  segWrap: { paddingHorizontal: 14 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginTop: 16, marginHorizontal: 14 },
  seg: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: colors.surface2 },
  segPill: { position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: 9, backgroundColor: colors.accent },
  segBtn: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' },
  segText: { color: colors.text2, fontFamily: fonts.bold, fontSize: 14 },
  segTextOn: { color: '#000' },
});
