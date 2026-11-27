// Welcome 3/3: pick the look — the app's own two kinds, Default (glass themes) and Pop (8 Pop themes).
// Only the theme is chosen here; the dock starts as Apple Music style and can be changed later in Settings.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { hapticTick } from '../../components/haptics';
import { en } from '../../i18n/strings';
import { POP_THEME_NAMES, POP_THEME_ORDER, POP_THEMES, PopThemeId } from '../../theme/pop';
import { PRESETS, ThemePresetId } from '../../theme/presets';
import { BackButton, Dots, Hard, Headline, OB, PopButton } from './kit';

export const DEFAULT_CHOICES: ThemePresetId[] = ['dark', 'light', 'green', 'ocean', 'latte', 'snow', 'sakura', 'meteor', 'starry', 'aurora', 'rain', 'neon'];
export type LookChoice = { kind: 'glass'; preset: ThemePresetId } | { kind: 'pop'; theme: PopThemeId };

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
};

// A small home screen in the chosen look, with the Apple Music style dock
function Preview({ look }: { look: LookChoice }) {
  const pop = look.kind === 'pop';
  const p = pop ? POP_THEMES[look.theme] : PRESETS[look.preset];
  const light = lum(p.bg) > 150;
  const chrome = pop
    ? { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#111111' }
    : { backgroundColor: light ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.28)' };
  const card = (k: number, label: string) => (
    <View key={k} style={{ width: 84 }}>
      <View style={[{ height: 72, borderRadius: 12, backgroundColor: p.accent, opacity: k === 1 ? 0.55 : 1 }, pop && { borderWidth: 2, borderColor: '#111' }]} />
      <Text numberOfLines={1} style={{ color: p.text, fontSize: 11, fontWeight: '700', marginTop: 4, opacity: 0.85 }}>
        {label}
      </Text>
    </View>
  );
  return (
    <Hard radius={24} offset={5} style={{ height: 210, overflow: 'hidden', backgroundColor: p.bg, borderRadius: 24 }}>
      {!pop && <LinearGradient colors={[p.accent + '55', 'transparent']} start={{ x: 0.1, y: 0 }} end={{ x: 0.6, y: 0.7 }} style={StyleSheet.absoluteFill} />}
      <Animated.View key={pop ? look.theme : look.preset} entering={FadeIn.duration(250)} style={{ flex: 1 }}>
        <Text style={{ color: p.text, fontSize: 18, fontWeight: '900', margin: 14, marginBottom: 8 }}>Good evening</Text>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14 }}>{['Daily Mix', 'On repeat', 'New for you'].map((l, k) => card(k, l))}</View>
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', gap: 8 }}>
          <View style={[{ flex: 1, height: 42, borderRadius: 21, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, chrome]}>
            {[0, 1, 2, 3].map((k) => (
              <View key={k} style={{ width: 16, height: 16, borderRadius: 5, backgroundColor: k ? (pop ? '#111' : p.text) : p.accent, opacity: k ? 0.45 : 1 }} />
            ))}
          </View>
          <View style={[{ width: 42, height: 42, borderRadius: 21 }, chrome]} />
        </View>
      </Animated.View>
    </Hard>
  );
}

export function LookStep({ look, setLook, onBack, onNext, scale }: { look: LookChoice; setLook: (l: LookChoice) => void; onBack: () => void; onNext: () => void; scale: number }) {
  const pop = look.kind === 'pop';
  const list = pop
    ? POP_THEME_ORDER.map((id) => ({ id, bg: POP_THEMES[id].bg, acc: POP_THEMES[id].accent, name: POP_THEME_NAMES[id] }))
    : DEFAULT_CHOICES.map((id) => ({ id, bg: PRESETS[id].bg, acc: PRESETS[id].accent, name: en[`preset.${id}` as keyof typeof en] ?? id }));
  const current = pop ? look.theme : look.preset;
  const name = list.find((x) => x.id === current)?.name ?? '';
  const seg = (kind: 'glass' | 'pop', label: string) => (
    <Pressable
      onPress={() => {
        if (look.kind === kind) return;
        hapticTick();
        setLook(kind === 'pop' ? { kind: 'pop', theme: 'lilac' } : { kind: 'glass', preset: 'dark' });
      }}
      style={[styles.seg, look.kind === kind && { backgroundColor: OB.ink }]}
      accessibilityRole="button"
      accessibilityState={{ selected: look.kind === kind }}
    >
      <Text style={[styles.segText, look.kind === kind && { color: OB.acc }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1 }}>
      <Dots at={2} />
      <Headline size={44 * scale} style={{ marginTop: 14 }}>
        Pick your look
      </Headline>
      <Hard style={{ flexDirection: 'row', overflow: 'hidden', backgroundColor: OB.paper, marginTop: 14 }}>
        {seg('glass', 'Default')}
        {seg('pop', 'Pop')}
      </Hard>
      <View style={{ marginTop: 16 }}>
        <Preview look={look} />
      </View>
      <View style={styles.swatches}>
        {list.map((x) => {
          const on = x.id === current;
          return (
            <Pressable
              key={x.id}
              onPress={() => {
                hapticTick();
                setLook(pop ? { kind: 'pop', theme: x.id as PopThemeId } : { kind: 'glass', preset: x.id as ThemePresetId });
              }}
              hitSlop={4}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={x.name}
              style={[styles.swRing, on && { borderColor: OB.ink }]}
            >
              <View style={[styles.sw, { backgroundColor: x.bg }]}>
                <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%', backgroundColor: x.acc }} />
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.name}>
        {pop ? 'Pop' : 'Default'} · {name}
      </Text>
      <Text style={styles.note}>Dock: Apple Music style. You can change it later in Settings.</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 'auto' }}>
        <BackButton onPress={onBack} />
        <PopButton kind="ink" label="Next" onPress={onNext} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seg: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  segText: { fontSize: 15, fontWeight: '900', color: OB.ink },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  swRing: { padding: 2, borderRadius: 22, borderWidth: 2.5, borderColor: 'transparent' },
  sw: { width: 32, height: 32, borderRadius: 16, borderWidth: 2.5, borderColor: OB.ink, overflow: 'hidden' },
  name: { fontSize: 14, fontWeight: '800', color: OB.ink, marginTop: 10 },
  note: { fontSize: 13, fontWeight: '600', color: OB.ink, opacity: 0.75, marginTop: 2 },
});
