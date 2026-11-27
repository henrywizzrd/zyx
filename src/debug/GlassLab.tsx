import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassFill, hasLiquidGlass, type GlassMaterial } from '../components/Glass';

// GLASS LAB (beta debug only): for every glass material, the dock version (real iOS Liquid Glass) next to the
// self-drawn version used everywhere else in the app, on the same busy background. Screenshot this screen to
// compare them side by side. Matte and Neon are self-drawn on the dock too, so both cards should look the same.
const MATERIALS: { id: GlassMaterial; label: string }[] = [
  { id: 'clear', label: 'Clear' },
  { id: 'frost', label: 'Frosted' },
  { id: 'neon', label: 'Neon' },
];

function Busy() {
  // colourful stripes + text behind the glass so blur, tint and refraction are easy to see
  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={['#ff4d6d', '#ffd166', '#06d6a0', '#118ab2', '#7b2ff7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={[styles.busyText, { top: 4 + i * 17 }]} numberOfLines={1}>
          ZYX glass lab · vinyl · smoke · lyrics · ZYX glass lab · vinyl
        </Text>
      ))}
    </View>
  );
}

function Card({ material, liquid, title }: { material: GlassMaterial; liquid: boolean; title: string }) {
  return (
    <View style={styles.card}>
      <GlassFill radius={18} slab material={material} liquid={liquid} />
      <Text style={styles.cardText}>{title}</Text>
    </View>
  );
}

export function GlassLab({ text, sub }: { text: string; sub: string }) {
  return (
    <View style={{ marginTop: 8, gap: 12 }}>
      <Text style={{ color: sub, fontSize: 12 }}>
        Left: dock glass ({hasLiquidGlass ? 'real Liquid Glass' : 'no Liquid Glass on this device'}). Right: glass inside pages (self-drawn). Uses the current
        "Glass blur" level from Theme Studio.
      </Text>
      {MATERIALS.map((m) => (
        <View key={m.id} style={{ gap: 6 }}>
          <Text style={{ color: text, fontWeight: '700' }}>{m.label}</Text>
          <View style={styles.sample}>
            <Busy />
            <Card material={m.id} liquid title="Dock" />
            <Card material={m.id} liquid={false} title="In pages" />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sample: { height: 110, borderRadius: 20, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', padding: 12 },
  busyText: { position: 'absolute', left: 6, right: 6, color: '#111', fontWeight: '800', fontSize: 13, opacity: 0.55 },
  card: { width: '44%', height: 80, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  cardText: { color: '#fff', fontWeight: '800', fontSize: 15, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
});
