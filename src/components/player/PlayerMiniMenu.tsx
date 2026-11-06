import { type ComponentRef, type ReactNode, useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Icon } from '@/components/Icon';
import { PressableScale } from '@/components/PressableScale';
import { qualityBadge } from '@/lib/quality';
import { fonts } from '@/lib/theme';
import type { SheetSection } from './PlayerSettingsSheet';

export const MINI_MENU_WIDTH = 176;

// Each option has its own colour everywhere it appears, so it can be found without reading it.
export const PLAYER_COLOURS: Record<string, string> = {
  audio: '#60A5FA',
  subtitles: '#FDE047',
  speed: '#FB923C',
  quality: '#4ADE80',
  autoNext: '#A78BFA',
  autoplay: '#A78BFA',
  fit: '#2DD4BF',
  enhance: '#FFC12E',
};

// A small outlined tag naming the quality, the way streaming apps show it.
const BADGE_COLOURS: Record<string, string> = { '4K': '#FFC12E', '2K': '#FFC12E', FHD: '#4ADE80', HD: '#4ADE80', SD: 'rgba(255,255,255,0.6)' };

export function QualityBadge({ name }: { name: string }) {
  const colour = BADGE_COLOURS[name] ?? '#fff';
  return (
    <View style={[styles.badge, { borderColor: colour }]}>
      <Text style={[styles.badgeText, { color: colour }]}>{name}</Text>
    </View>
  );
}

const OPEN = { damping: 20, stiffness: 340, mass: 0.7 };

// A small menu that grows out of the option tapped (language, subtitles, speed, quality), with
// that option's icon and colour. One tap on a choice applies it and closes the menu; a tap
// anywhere else just closes it. The video stays fully in view the whole time.
export function PlayerMiniMenu({
  section,
  head,
  accent,
  x,
  bottom,
  onClose,
}: {
  section: SheetSection | undefined;
  head: ReactNode; // the option's icon
  accent: string; // and its colour
  x: number;
  bottom: number;
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

  const dimStyle = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 1], [0, 1], 'clamp') }));

  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const shown = section ?? last.current;
  if (!mounted || !shown) return null;
  const options = shown.options ?? [];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[styles.dim, dimStyle]} pointerEvents="none" />
      <PressableScale style={StyleSheet.absoluteFill} scaleTo={1} onPress={onClose} accessibilityLabel="Close menu" />
      <Animated.View style={[styles.card, { left: x, bottom }, cardStyle]}>
        <View style={styles.head}>
          {head}
          <Text style={styles.title} numberOfLines={1}>
            {shown.title}
          </Text>
        </View>
        <ScrollView ref={scroll} style={styles.list} showsVerticalScrollIndicator={false} bounces={false}>
          {options.map((o) => {
            const badge = shown.key === 'quality' ? qualityBadge(Number(o.key) || 0) : null;
            return (
              <PressableScale
                key={o.key}
                disabled={o.disabled}
                scaleTo={0.98}
                // A long list opens with the current choice in view.
                onLayout={o.selected ? (e) => scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 32), animated: false }) : undefined}
                onPress={() => {
                  onClose();
                  o.onSelect();
                }}
                style={[styles.row, o.selected && { backgroundColor: `${accent}26` }, o.disabled && styles.rowOff]}
                accessibilityRole="button"
                accessibilityState={{ selected: o.selected, disabled: !!o.disabled }}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.label, o.selected && styles.labelOn]} numberOfLines={1}>
                    {o.label}
                  </Text>
                  {o.hint && !badge ? (
                    <Text style={styles.hint} numberOfLines={1}>
                      {o.hint}
                    </Text>
                  ) : null}
                </View>
                {badge ? <QualityBadge name={badge} /> : null}
                <View style={styles.tick}>{o.selected ? <Icon name="check" size={14} color={accent} /> : null}</View>
              </PressableScale>
            );
          })}
          {options.length < 2 && shown.emptyText ? <Text style={styles.empty}>{shown.emptyText}</Text> : null}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.25)' },
  // See-through like the chips below it, so the picture carries on behind it.
  card: {
    position: 'absolute',
    width: MINI_MENU_WIDTH,
    maxHeight: '64%', // of the screen as it is now: a size worked out in JS can be from before a turn
    paddingBottom: 4,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(16,16,20,0.7)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    transformOrigin: 'left bottom',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 10 },
  title: { flex: 1, color: 'rgba(255,255,255,0.72)', fontFamily: fonts.bold, fontSize: 11.5 },
  list: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30, paddingVertical: 3, paddingLeft: 8, paddingRight: 6, marginHorizontal: 4, borderRadius: 9 },
  rowOff: { opacity: 0.4 },
  tick: { width: 15, alignItems: 'center' },
  rowText: { flex: 1 },
  label: { color: 'rgba(255,255,255,0.88)', fontFamily: fonts.medium, fontSize: 12.5, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  labelOn: { color: '#fff', fontFamily: fonts.bold },
  hint: { color: 'rgba(255,255,255,0.6)', fontFamily: fonts.regular, fontSize: 10, marginTop: 0.5, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  badge: { height: 15, paddingHorizontal: 3.5, borderWidth: 1.2, borderRadius: 3.5, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.black, fontSize: 9, lineHeight: 11, letterSpacing: 0.3 },
  empty: { color: 'rgba(255,255,255,0.65)', fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, paddingHorizontal: 10, paddingTop: 2, paddingBottom: 4 },
});
