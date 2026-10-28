import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { colors, fonts } from '@/lib/theme';

// iOS-style deceleration: fast start, long soft landing.
const OPEN = { duration: 340, easing: Easing.bezier(0.2, 0.9, 0.25, 1) };
const CLOSE = { duration: 220, easing: Easing.bezier(0.4, 0, 1, 1) };

// Modern bottom sheet: slides up over a dimmed backdrop, can be dragged down
// by its handle or header to dismiss, and plays its exit before unmounting.
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(height);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = height;
      y.value = withTiming(0, OPEN);
    } else if (mounted) {
      y.value = withTiming(height, CLOSE, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Drag the handle/header down to close; a short drag springs back.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => {
          y.value = Math.max(0, g.dy);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > 110 || g.vy > 0.9) onClose();
          else y.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
        },
      }),
    [onClose, y]
  );

  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  // Backdrop fades with the sheet's position, so dragging dims it live.
  const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, height * 0.6], [1, 0], 'clamp') }));

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { maxHeight: height * 0.88, paddingBottom: insets.bottom + 14 }, sheet]}>
        <View {...pan.panHandlers}>
          <View style={styles.grabberZone}>
            <View style={styles.grabber} />
          </View>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <PressableScale onPress={onClose} hitSlop={10} style={styles.close} accessibilityLabel="Close">
              <Icon name="x" size={17} color={colors.text2} />
            </PressableScale>
          </View>
        </View>
        <View style={{ flexShrink: 1 }}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.62)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#17181d',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -6 },
    elevation: 24,
  },
  grabberZone: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  grabber: { width: 42, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { color: '#fff', fontFamily: fonts.black, fontSize: 20, letterSpacing: -0.2 },
  subtitle: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 2 },
  close: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
});
