// Shared pieces for the welcome screens (27/11): Pop Lilac colours, poster headline, chunky buttons, a vinyl record.
// The welcome screens always use this look, whatever theme the app is set to.
import React, { useEffect } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { CONDENSED_FONT, DISPLAY_FONT } from '../../theme/fonts';

export const OB = { bg: '#A98BF5', ink: '#111111', acc: '#D4F25A', paper: '#FFFFFF' };
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const EASE_IN_OUT = Easing.bezier(0.77, 0, 0.175, 1);

// Condensed caps headline. lineHeight below the font size, like the poster references
export function Headline({ children, size, style }: { children: React.ReactNode; size: number; style?: StyleProp<TextStyle> }) {
  return (
    <Text allowFontScaling={false} style={[{ fontFamily: CONDENSED_FONT, fontWeight: 'normal', fontSize: size, lineHeight: size * 0.94, color: OB.ink, textTransform: 'uppercase', includeFontPadding: false }, style]}>
      {children}
    </Text>
  );
}

// A box with a hard shadow: a solid ink copy sits behind it, offset down-right.
// style is the box itself; margins, rotation and position go in outer (so the shadow moves with the box).
export function Hard({ children, style, outer, offset = 4, radius = 999, color = OB.ink, pressed }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; outer?: StyleProp<ViewStyle>; offset?: number; radius?: number; color?: string; pressed?: boolean }) {
  const o = pressed ? 1 : offset;
  return (
    <View style={[{ paddingRight: offset, paddingBottom: offset }, outer]}>
      <View style={{ position: 'absolute', left: offset, top: offset, right: 0, bottom: 0, borderRadius: radius, backgroundColor: color }} />
      <View style={[{ borderRadius: radius, borderWidth: 2.5, borderColor: OB.ink, transform: [{ translateX: offset - o }, { translateY: offset - o }] }, style]}>{children}</View>
    </View>
  );
}

// Big pill button. kind: paper (white), ink (black with lime text)
export function PopButton({ label, onPress, kind = 'paper', icon, disabled, style }: { label: string; onPress: () => void; kind?: 'paper' | 'ink'; icon?: React.ReactNode; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={style} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <Hard pressed={pressed} style={[styles.btn, { backgroundColor: kind === 'ink' ? OB.ink : OB.paper, opacity: disabled ? 0.6 : 1 }]}>
          {icon}
          <Text numberOfLines={1} style={[styles.btnText, { color: kind === 'ink' ? OB.acc : OB.ink }]}>
            {label}
          </Text>
        </Hard>
      )}
    </Pressable>
  );
}

// Round back button with an arrow
export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Back" hitSlop={6}>
      {({ pressed }) => (
        <Hard pressed={pressed} style={[styles.btn, { width: 54, paddingHorizontal: 0, backgroundColor: OB.paper }]}>
          <Text style={[styles.btnText, { fontSize: 20 }]}>←</Text>
        </Hard>
      )}
    </Pressable>
  );
}

// Progress dashes for the 3 intro screens
export function Dots({ at, count = 3 }: { at: number; count?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: 22, height: 5, borderRadius: 3, backgroundColor: OB.ink, opacity: i === at ? 1 : 0.25 }} />
      ))}
    </View>
  );
}

// Vinyl record. Grooves are rings; the light sheen stays still while the record turns (like a real one)
export function Vinyl({ size, spin = 0, label = 'ZYX', labelColor = OB.acc, border = 2.5, style }: { size: number; spin?: number; label?: string; labelColor?: string; border?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => {
    if (!spin || reduced) return;
    r.value = 0;
    r.value = withRepeat(withTiming(360, { duration: spin, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(r);
  }, [spin, reduced, r]);
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  const rings = Math.max(4, Math.round(size / 14));
  const lab = size * 0.34;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#161616', borderWidth: border, borderColor: OB.ink, overflow: 'hidden' }, style]}>
      <Animated.View style={[StyleSheet.absoluteFill, turn]}>
        {Array.from({ length: rings }, (_, i) => {
          const inset = 4 + (i * (size / 2 - lab / 2 - 8)) / rings;
          return <View key={i} style={{ position: 'absolute', left: inset, top: inset, right: inset, bottom: inset, borderRadius: size, borderWidth: 1, borderColor: i % 2 ? '#2B2B2B' : '#222222' }} />;
        })}
        <View style={{ position: 'absolute', left: (size - lab) / 2 - border, top: (size - lab) / 2 - border, width: lab, height: lab, borderRadius: lab / 2, backgroundColor: labelColor, borderWidth: 2, borderColor: OB.ink, alignItems: 'center', justifyContent: 'center' }}>
          {!!label && (
            <Text allowFontScaling={false} style={{ fontFamily: DISPLAY_FONT, fontWeight: 'normal', fontSize: Math.max(8, lab * 0.2), color: OB.ink, includeFontPadding: false }}>
              {label}
            </Text>
          )}
          <View style={{ position: 'absolute', width: Math.max(5, lab * 0.1), height: Math.max(5, lab * 0.1), borderRadius: 10, backgroundColor: OB.ink }} />
        </View>
      </Animated.View>
      <LinearGradient
        pointerEvents="none"
        colors={['transparent', 'rgba(255,255,255,0.16)', 'transparent', 'transparent', 'rgba(255,255,255,0.10)', 'transparent']}
        locations={[0.1, 0.22, 0.34, 0.62, 0.74, 0.86]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { height: 54, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  btnText: { fontSize: 16, fontWeight: '800', color: OB.ink },
});
