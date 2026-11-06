import { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, type IconName } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { qualityBadge } from '@/lib/quality';
import { fonts } from '@/lib/theme';
import { PLAYER_COLOURS, QualityBadge } from './PlayerMiniMenu';

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

const SPRING = { damping: 24, stiffness: 300, mass: 0.8 };
const HEAD_HEIGHT = 48;
const ROW_HEIGHT = 46;

// Player settings, in the same style as the player's own menus: see-through and plain, with each
// option in its own colour. In fullscreen it floats at the right; in portrait it rises only as
// high as it needs and stops below the player. The main list shows every setting with its current
// value; tapping one glides its choices in. Everything scrolls inside the card.
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
      progress.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }, (done) => {
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
    page.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) runOnJS(setSection)(null);
    });
  };

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() =>
    fullscreen
      ? {
          opacity: interpolate(progress.value, [0, 0.4], [0, 1], 'clamp'),
          transform: [{ translateX: interpolate(progress.value, [0, 1], [40, 0]) }],
        }
      : { transform: [{ translateY: interpolate(progress.value, [0, 1], [height * 0.7, 0]) }] }
  );
  const mainStyle = useAnimatedStyle(() => ({
    opacity: interpolate(page.value, [0, 0.6], [1, 0], 'clamp'),
    transform: [{ translateX: interpolate(page.value, [0, 1], [0, -32]) }],
  }));
  const subStyle = useAnimatedStyle(() => ({
    opacity: interpolate(page.value, [0.3, 1], [0, 1], 'clamp'),
    transform: [{ translateX: interpolate(page.value, [0, 1], [48, 0]) }],
  }));

  if (!rendered) return null;
  const current = sections.find((s) => s.key === section);
  const accent = (current && PLAYER_COLOURS[current.key]) || '#fff';

  // Just tall enough for its rows, and never over the player above it.
  const playerBottom = insets.top + (width * 9) / 16;
  const naturalHeight = 14 + HEAD_HEIGHT + sections.length * ROW_HEIGHT + 8 + Math.max(insets.bottom, 10);
  const placement = fullscreen
    ? { top: 12, bottom: 12, right: Math.max(insets.right, 12), width: Math.min(340, width * 0.42), borderRadius: 16 }
    : { left: 0, right: 0, bottom: 0, height: Math.min(naturalHeight, height - playerBottom), borderTopLeftRadius: 18, borderTopRightRadius: 18 };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <PressableScale style={StyleSheet.absoluteFill} scaleTo={1} onPress={onClose} accessibilityLabel="Close settings" />
      </Animated.View>

      <Animated.View style={[styles.panel, placement, panelStyle]}>
        {!fullscreen ? <View style={styles.handle} /> : null}

        <View style={[styles.pages, !fullscreen && { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {/* Main list */}
          <Animated.View style={[styles.page, mainStyle]} pointerEvents={section ? 'none' : 'auto'}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Settings</Text>
              <PressableScale onPress={onClose} style={styles.headerBtn} hitSlop={8} accessibilityLabel="Close">
                <Icon name="x" size={17} color="rgba(255,255,255,0.8)" />
              </PressableScale>
            </View>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
              {sections.map((s) => {
                const colour = PLAYER_COLOURS[s.key] ?? 'rgba(255,255,255,0.8)';
                const badge = s.key === 'quality' ? qualityBadge(parseInt(s.value, 10) || 0) : null;
                return (
                  <PressableScale
                    key={s.key}
                    scaleTo={0.985}
                    onPress={() => (s.toggle ? s.toggle.onChange(!s.toggle.value) : s.options ? openSection(s.key) : s.onPress?.())}
                    style={styles.row}
                  >
                    <View style={styles.rowIcon}>{badge ? <QualityBadge name={badge} /> : <Icon name={s.icon} size={19} color={colour} />}</View>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {s.title}
                    </Text>
                    {s.toggle ? (
                      <Switch value={s.toggle.value} onValueChange={s.toggle.onChange} trackColor={{ false: 'rgba(255,255,255,0.18)', true: colour }} thumbColor="#fff" />
                    ) : (
                      <View style={styles.value}>
                        <Text style={styles.rowValue} numberOfLines={1}>
                          {s.value}
                        </Text>
                        <Icon name="right" size={13} color="rgba(255,255,255,0.45)" />
                      </View>
                    )}
                  </PressableScale>
                );
              })}
            </ScrollView>
          </Animated.View>

          {/* Choices for one setting */}
          {current ? (
            <Animated.View style={[styles.page, styles.pageTop, subStyle]}>
              <View style={styles.header}>
                <PressableScale onPress={initialSection ? onClose : goMain} style={styles.headerBack} hitSlop={8} accessibilityLabel="Back">
                  <Icon name={initialSection ? 'x' : 'left'} size={17} color="rgba(255,255,255,0.8)" />
                </PressableScale>
                <Text style={[styles.headerTitle, { flex: 1 }]} numberOfLines={1}>
                  {current.title}
                </Text>
              </View>
              <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
                {current.options?.length ? (
                  current.options.map((o) => {
                    const badge = current.key === 'quality' ? qualityBadge(Number(o.key) || 0) : null;
                    return (
                      <PressableScale
                        key={o.key}
                        disabled={o.disabled}
                        scaleTo={0.985}
                        onPress={() => {
                          o.onSelect();
                          if (initialSection) onClose();
                          else goMain();
                        }}
                        style={[styles.option, o.selected && { backgroundColor: `${accent}26` }, o.disabled && { opacity: 0.4 }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.optionLabel, o.selected && styles.optionLabelOn]} numberOfLines={1}>
                            {o.label}
                          </Text>
                          {o.hint && !badge ? (
                            <Text style={styles.optionHint} numberOfLines={1}>
                              {o.hint}
                            </Text>
                          ) : null}
                        </View>
                        {badge ? <QualityBadge name={badge} /> : null}
                        <View style={styles.tick}>{o.selected ? <Icon name="check" size={15} color={accent} /> : null}</View>
                      </PressableScale>
                    );
                  })
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
  backdrop: { backgroundColor: 'rgba(0,0,0,0.3)' },
  panel: { position: 'absolute', overflow: 'hidden', backgroundColor: 'rgba(18,18,22,0.8)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  handle: { alignSelf: 'center', width: 32, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 7, marginBottom: 4 },
  pages: { flex: 1 },
  page: { flex: 1 },
  pageTop: { ...StyleSheet.absoluteFill },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: HEAD_HEIGHT, paddingHorizontal: 16 },
  headerTitle: { color: '#fff', fontFamily: fonts.bold, fontSize: 15 },
  headerBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  headerBack: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: -8, marginRight: 4 },
  scroll: { flex: 1 },
  list: { paddingHorizontal: 8, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, height: ROW_HEIGHT, paddingHorizontal: 8, borderRadius: 10 },
  rowIcon: { width: 28, alignItems: 'center' },
  rowTitle: { flex: 1, color: 'rgba(255,255,255,0.92)', fontFamily: fonts.medium, fontSize: 14 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 150 },
  rowValue: { color: 'rgba(255,255,255,0.6)', fontFamily: fonts.regular, fontSize: 13, flexShrink: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  optionLabel: { color: 'rgba(255,255,255,0.85)', fontFamily: fonts.medium, fontSize: 14 },
  optionLabelOn: { color: '#fff', fontFamily: fonts.bold },
  optionHint: { color: 'rgba(255,255,255,0.5)', fontFamily: fonts.regular, fontSize: 11.5, marginTop: 1 },
  tick: { width: 18, alignItems: 'center' },
  empty: { color: 'rgba(255,255,255,0.6)', fontFamily: fonts.regular, fontSize: 13, padding: 10, lineHeight: 18 },
});
