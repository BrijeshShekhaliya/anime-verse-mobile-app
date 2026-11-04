import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { colors, fonts } from '@/lib/theme';
import type { SheetSection } from './PlayerSettingsSheet';

export const MINI_MENU_WIDTH = 236;

const OPEN = { damping: 20, stiffness: 340, mass: 0.7 };

// A small menu that grows out of the option tapped (language, subtitles, speed,
// quality). One tap on a choice applies it and closes the menu; a tap anywhere
// else just closes it. The video stays fully in view the whole time.
export function PlayerMiniMenu({
  section,
  x,
  bottom,
  maxHeight,
  onClose,
}: {
  section: SheetSection | undefined;
  x: number;
  bottom: number;
  maxHeight: number;
  onClose: () => void;
}) {
  const open = !!section;
  const [mounted, setMounted] = useState(open);
  // Keeps its last list on screen while it fades out.
  const last = useRef(section);
  if (section) last.current = section;

  const progress = useSharedValue(0);
  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withSpring(1, OPEN);
    } else {
      progress.value = withTiming(0, { duration: 110, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [open, progress]);

  // Android back closes the menu first.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [10, 0]) }, { scale: interpolate(progress.value, [0, 1], [0.92, 1]) }],
  }));

  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const shown = section ?? last.current;
  if (!mounted || !shown) return null;
  const options = shown.options ?? [];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <PressableScale style={StyleSheet.absoluteFill} scaleTo={1} onPress={onClose} accessibilityLabel="Close menu" />
      <Animated.View style={[styles.card, { left: x, bottom, maxHeight }, cardStyle]}>
        <Text style={styles.title} numberOfLines={1}>
          {shown.title}
        </Text>
        <ScrollView ref={scroll} style={styles.list} showsVerticalScrollIndicator={false} bounces={false}>
          {options.map((o) => (
            <PressableScale
              key={o.key}
              disabled={o.disabled}
              scaleTo={0.98}
              // A long list opens with the current choice in view.
              onLayout={o.selected ? (e) => scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 44), animated: false }) : undefined}
              onPress={() => {
                onClose();
                o.onSelect();
              }}
              style={[styles.row, o.selected && styles.rowOn, o.disabled && styles.rowOff]}
              accessibilityRole="button"
              accessibilityState={{ selected: o.selected, disabled: !!o.disabled }}
            >
              <View style={styles.tick}>{o.selected ? <Icon name="check" size={16} color={colors.accent} /> : null}</View>
              <View style={styles.rowText}>
                <Text style={[styles.label, o.selected && styles.labelOn]} numberOfLines={1}>
                  {o.label}
                </Text>
                {o.hint ? (
                  <Text style={styles.hint} numberOfLines={1}>
                    {o.hint}
                  </Text>
                ) : null}
              </View>
            </PressableScale>
          ))}
          {options.length < 2 && shown.emptyText ? <Text style={styles.empty}>{shown.emptyText}</Text> : null}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    width: MINI_MENU_WIDTH,
    paddingTop: 10,
    paddingBottom: 6,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(22,23,28,0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    transformOrigin: 'left bottom',
  },
  title: { color: 'rgba(255,255,255,0.55)', fontFamily: fonts.bold, fontSize: 12, paddingHorizontal: 14, marginBottom: 4 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingVertical: 6, paddingRight: 12, marginHorizontal: 6, borderRadius: 10 },
  rowOn: { backgroundColor: 'rgba(255,255,255,0.07)' },
  rowOff: { opacity: 0.4 },
  tick: { width: 30, alignItems: 'center' },
  rowText: { flex: 1 },
  label: { color: 'rgba(255,255,255,0.86)', fontFamily: fonts.medium, fontSize: 14 },
  labelOn: { color: '#fff', fontFamily: fonts.bold },
  hint: { color: 'rgba(255,255,255,0.45)', fontFamily: fonts.regular, fontSize: 11.5, marginTop: 1 },
  empty: { color: 'rgba(255,255,255,0.5)', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 6 },
});
