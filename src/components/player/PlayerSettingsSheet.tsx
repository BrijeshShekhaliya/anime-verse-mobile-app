import { BlurView } from 'expo-blur';
import { useEffect, useState } from 'react';
import { BackHandler, Platform, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { colors, fonts } from '@/lib/theme';

export type SheetOption = { key: string; label: string; hint?: string; selected: boolean; disabled?: boolean; onSelect: () => void };
export type SheetSection = {
  key: string;
  title: string;
  icon: IconName;
  value: string;
  options?: SheetOption[];
  emptyText?: string;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
  onPress?: () => void;
};

type Insets = { top: number; bottom: number; left: number; right: number };

const SPRING = { damping: 22, stiffness: 240, mass: 0.9 };

// Player settings on a frosted-glass card. In fullscreen it floats at the
// right, clear of the edges, so the video stays in view; in portrait it rises
// from the bottom. The main list shows every setting with its current value;
// tapping one glides its choices in. Opened from a quick chip (audio,
// subtitles...), it goes straight to that list and closes once something is
// picked. Everything scrolls inside the card, so nothing spills out of it.
export function PlayerSettingsSheet({
  open,
  initialSection,
  sections,
  fullscreen,
  insets,
  onClose,
}: {
  open: boolean;
  initialSection?: string;
  sections: SheetSection[];
  fullscreen: boolean;
  insets: Insets;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [rendered, setRendered] = useState(open);
  const [section, setSection] = useState<string | null>(initialSection ?? null);
  const progress = useSharedValue(0);
  const page = useSharedValue(initialSection ? 1 : 0);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setSection(initialSection ?? null);
      page.value = initialSection ? 1 : 0;
      progress.value = withSpring(1, SPRING);
    } else if (rendered) {
      progress.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(setRendered)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSection]);

  // Android back: one level up, then close.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (section && !initialSection) goMain();
      else onClose();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, section, initialSection, onClose]);

  const openSection = (key: string) => {
    setSection(key);
    page.value = withSpring(1, SPRING);
  };
  const goMain = () => {
    page.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) runOnJS(setSection)(null);
    });
  };

  const gap = 12;
  const panelW = fullscreen ? Math.min(380, width * 0.44) : width;
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() =>
    fullscreen
      ? {
          opacity: interpolate(progress.value, [0, 0.4], [0, 1], 'clamp'),
          transform: [{ translateX: interpolate(progress.value, [0, 1], [56, 0]) }, { scale: interpolate(progress.value, [0, 1], [0.96, 1]) }],
        }
      : { transform: [{ translateY: interpolate(progress.value, [0, 1], [height * 0.7, 0]) }] }
  );
  const mainStyle = useAnimatedStyle(() => ({
    opacity: interpolate(page.value, [0, 0.6], [1, 0], 'clamp'),
    transform: [{ translateX: interpolate(page.value, [0, 1], [0, -40]) }],
  }));
  const subStyle = useAnimatedStyle(() => ({
    opacity: interpolate(page.value, [0.3, 1], [0, 1], 'clamp'),
    transform: [{ translateX: interpolate(page.value, [0, 1], [60, 0]) }],
  }));

  if (!rendered) return null;
  const current = sections.find((s) => s.key === section);

  const placement = fullscreen
    ? {
        top: Math.max(insets.top, gap),
        bottom: Math.max(insets.bottom, gap),
        right: Math.max(insets.right, gap),
        width: panelW,
        borderRadius: 24,
      }
    : { left: 0, right: 0, bottom: 0, maxHeight: height * 0.72, borderTopLeftRadius: 26, borderTopRightRadius: 26 };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <PressableScale style={StyleSheet.absoluteFill} scaleTo={1} onPress={onClose} accessibilityLabel="Close settings" />
      </Animated.View>

      <Animated.View style={[styles.panel, placement, !fullscreen && { height: height * 0.72 }, panelStyle]}>
        {/* Frosted glass (a real blur on Android too), with a dark tint over it. */}
        <BlurView
          intensity={45}
          tint="dark"
          experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, styles.tint]} />
        {!fullscreen ? <View style={styles.handle} /> : null}

        <View style={[styles.pages, !fullscreen && { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {/* Main list */}
          <Animated.View style={[styles.page, mainStyle]} pointerEvents={section ? 'none' : 'auto'}>
            <View style={styles.header}>
              <View>
                <Text style={styles.kicker}>PLAYER</Text>
                <Text style={styles.headerTitle}>Settings</Text>
              </View>
              <PressableScale onPress={onClose} style={styles.headerBtn} hitSlop={8} accessibilityLabel="Close">
                <Icon name="x" size={18} color="#fff" />
              </PressableScale>
            </View>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              {sections.map((s) => (
                <PressableScale
                  key={s.key}
                  scaleTo={0.98}
                  onPress={() => (s.toggle ? s.toggle.onChange(!s.toggle.value) : s.options ? openSection(s.key) : s.onPress?.())}
                  style={styles.row}
                >
                  <View style={styles.rowIcon}>
                    <Icon name={s.icon} size={17} color={colors.accent} />
                  </View>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {s.title}
                  </Text>
                  {s.toggle ? (
                    <Switch value={s.toggle.value} onValueChange={s.toggle.onChange} trackColor={{ false: 'rgba(255,255,255,0.18)', true: colors.accent }} thumbColor="#fff" />
                  ) : (
                    <View style={styles.valuePill}>
                      <Text style={styles.rowValue} numberOfLines={1}>
                        {s.value}
                      </Text>
                      <Icon name="right" size={14} color="rgba(255,255,255,0.55)" />
                    </View>
                  )}
                </PressableScale>
              ))}
            </ScrollView>
          </Animated.View>

          {/* Choices for one setting */}
          {current ? (
            <Animated.View style={[styles.page, styles.pageTop, subStyle]}>
              <View style={styles.header}>
                <PressableScale onPress={initialSection ? onClose : goMain} style={styles.headerBtn} hitSlop={8} accessibilityLabel="Back">
                  <Icon name={initialSection ? 'x' : 'left'} size={18} color="#fff" />
                </PressableScale>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.kicker}>SETTINGS</Text>
                  <Text style={styles.headerTitle} numberOfLines={1}>
                    {current.title}
                  </Text>
                </View>
              </View>
              <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
                {current.options?.length ? (
                  current.options.map((o) => (
                    <PressableScale
                      key={o.key}
                      disabled={o.disabled}
                      scaleTo={0.98}
                      onPress={() => {
                        o.onSelect();
                        if (initialSection) onClose();
                        else goMain();
                      }}
                      style={[styles.option, o.selected && styles.optionOn, o.disabled && { opacity: 0.4 }]}
                    >
                      <View style={[styles.radio, o.selected && styles.radioOn]}>{o.selected ? <View style={styles.radioDot} /> : null}</View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionLabel, o.selected && { color: '#fff' }]}>{o.label}</Text>
                        {o.hint ? <Text style={styles.optionHint}>{o.hint}</Text> : null}
                      </View>
                    </PressableScale>
                  ))
                ) : (
                  <Text style={styles.empty}>{current.emptyText || 'Nothing to choose here yet.'}</Text>
                )}
              </ScrollView>
            </Animated.View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { position: 'absolute', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  tint: { backgroundColor: 'rgba(16,17,22,0.72)' },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)', marginTop: 8 },
  pages: { flex: 1 },
  page: { flex: 1 },
  pageTop: { ...StyleSheet.absoluteFill },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  kicker: { color: colors.accent, fontFamily: fonts.black, fontSize: 10.5, letterSpacing: 1.6 },
  headerTitle: { color: '#fff', fontFamily: fonts.black, fontSize: 19, marginTop: 1 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  scroll: { flex: 1 },
  list: { padding: 12, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 10,
    paddingRight: 12,
    height: 58,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,100,10,0.14)' },
  rowTitle: { flex: 1, color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  valuePill: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 150 },
  rowValue: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.medium, fontSize: 13.5, flexShrink: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionOn: { backgroundColor: 'rgba(255,100,10,0.12)', borderColor: 'rgba(255,100,10,0.55)' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  optionLabel: { color: 'rgba(255,255,255,0.88)', fontFamily: fonts.bold, fontSize: 15 },
  optionHint: { color: 'rgba(255,255,255,0.5)', fontFamily: fonts.regular, fontSize: 12.5, marginTop: 2 },
  empty: { color: 'rgba(255,255,255,0.6)', fontFamily: fonts.regular, fontSize: 13.5, padding: 8, lineHeight: 19 },
});
