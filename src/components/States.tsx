import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { colors, fonts, radius } from '@/lib/theme';

export function EmptyState({ icon = 'spark', title, text, action, onAction }: { icon?: IconName; title: string; text?: string; action?: string; onAction?: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(350)} style={styles.wrap}>
      <View style={styles.badge}>
        <Icon name={icon} size={26} color={colors.accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {text ? <Text style={styles.text}>{text}</Text> : null}
      {action && onAction ? (
        <PressableScale haptic onPress={onAction} style={styles.btn}>
          <Text style={styles.btnText}>{action}</Text>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <EmptyState icon="x" title="Couldn’t load this" text={message} action="Try again" onAction={onRetry} />;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 48, gap: 10 },
  badge: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255,100,10,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { color: colors.text, fontFamily: fonts.black, fontSize: 18, textAlign: 'center' },
  text: { color: colors.muted, fontFamily: fonts.regular, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  btn: { marginTop: 10, backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 22, height: 42, justifyContent: 'center' },
  btnText: { color: '#000', fontFamily: fonts.black, fontSize: 13.5, textTransform: 'uppercase', letterSpacing: 0.6 },
});
