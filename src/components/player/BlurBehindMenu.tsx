import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import type { ScreenShape } from '@/lib/screenShape';

// Each step of the blur coming in and going out, 40 ms apart.
const STEPS_IN = [5, 10, 16];
const STEPS_OUT = [8, 0];

// Blurs the video while a selection menu is open. It holds its own state, so opening a menu
// re-renders only this and never the watch screen or the player inside. It stays a real view
// the whole time: a view that came and went would move the video and replace its surface.
export function BlurBehindMenu({ open, style = StyleSheet.absoluteFill, children }: { open: ScreenShape; style?: ViewStyle; children: ReactNode }) {
  const [blur, setBlur] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (steps: number[], i = 0) => {
      setBlur(steps[i]);
      if (i + 1 < steps.length) timer = setTimeout(() => run(steps, i + 1), 40);
    };
    const leave = open.subscribe(() => {
      if (timer) clearTimeout(timer);
      run(open.get() ? STEPS_IN : STEPS_OUT);
    });
    return () => {
      if (timer) clearTimeout(timer);
      leave();
    };
  }, [open]);
  return (
    <View collapsable={false} style={[style, blur > 0 && { filter: [{ blur }] }]}>
      {children}
    </View>
  );
}
