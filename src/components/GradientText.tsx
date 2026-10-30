import MaskedViewBase from '@react-native-masked-view/masked-view';
import type { ComponentType, ReactElement, ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Text, type StyleProp, type TextStyle } from 'react-native';

// The package's types predate React 19's; the component itself works as usual.
const MaskedView = MaskedViewBase as unknown as ComponentType<{ maskElement: ReactElement; children: ReactNode }>;

// Text filled with a gradient: the text is the mask, the gradient shows through.
export function GradientText({
  children,
  colors,
  style,
  horizontal = true,
}: {
  children: string;
  colors: readonly [string, string, ...string[]];
  style?: StyleProp<TextStyle>;
  horizontal?: boolean;
}) {
  return (
    <MaskedView maskElement={<Text style={style}>{children}</Text>}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 }}>
        {/* Invisible copy sizes the gradient to the text. */}
        <Text style={[style, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}
