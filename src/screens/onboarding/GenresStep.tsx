// Welcome 1/3: genres fall into a pile with real physics (matter-js), like the reference: outlined pills, tap to fill,
// drag to throw them around. Walls on both sides, the floor above the button and a lid at the top of the screen
// (added once everything has fallen) keep every pill inside. The physics runs on the JS thread and stops when the
// pile is still; positions go to the UI through one shared value.
// Reduce Motion: no falling, the pills are laid out in rows.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import Matter from 'matter-js';
import { hapticTick } from '../../components/haptics';
import { log as appLog } from '../../data/applog';
import { Dots, Headline, OB, PopButton } from './kit';

export const GENRES: { name: string; size: 's' | 'm' | 'l' }[] = [
  { name: 'Pop', size: 'l' }, { name: 'V-Pop', size: 'm' }, { name: 'Rap Việt', size: 'l' }, { name: 'Indie', size: 'm' },
  { name: 'Lofi', size: 's' }, { name: 'R&B', size: 'm' }, { name: 'K-Pop', size: 'l' }, { name: 'EDM', size: 's' },
  { name: 'Rock', size: 'm' }, { name: 'Ballad', size: 's' }, { name: 'Jazz', size: 's' }, { name: 'Hip Hop', size: 'm' },
  { name: 'Bolero', size: 's' }, { name: 'Synthwave', size: 'l' }, { name: 'Phonk', size: 'm' }, { name: 'Chill', size: 's' },
  { name: 'Metal', size: 's' }, { name: 'Acoustic', size: 's' },
];
const SZ = { s: { font: 13, h: 34, pad: 13 }, m: { font: 17, h: 44, pad: 18 }, l: { font: 23, h: 56, pad: 24 } };
const N = GENRES.length;
type Tagged = Matter.Body & { idx: number };

// Reduce Motion layout: rows from the bottom, small tilt
function rows(w: number[], h: number[], W: number, H: number): number[] {
  const out = new Array(N * 3).fill(0);
  let x = 0;
  let base = H;
  let rowH = 0;
  for (let i = 0; i < N; i++) {
    if (x + w[i] > W) {
      x = 0;
      base -= rowH + 6;
      rowH = 0;
    }
    out[i * 3] = x + w[i] / 2;
    out[i * 3 + 1] = base - h[i] / 2;
    out[i * 3 + 2] = ((i % 5) - 2) * 0.06;
    x += w[i] + 6;
    rowH = Math.max(rowH, h[i]);
  }
  return out;
}

function Pill({ i, name, size, w, h, pose, on, onToggle }: { i: number; name: string; size: 's' | 'm' | 'l'; w: number; h: number; pose: SharedValue<number[]>; on: boolean; onToggle: () => void }) {
  const st = useAnimatedStyle(() => {
    const p = pose.value;
    return { opacity: p[i * 3 + 1] < -9000 ? 0 : 1, transform: [{ translateX: p[i * 3] - w / 2 }, { translateY: p[i * 3 + 1] - h / 2 }, { rotate: `${p[i * 3 + 2]}rad` }] };
  });
  const z = SZ[size];
  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={name}
      onAccessibilityTap={onToggle}
      style={[styles.pill, { position: 'absolute', left: 0, top: 0, height: z.h, paddingHorizontal: z.pad, backgroundColor: on ? OB.ink : 'transparent' }, st]}
    >
      <Text allowFontScaling={false} style={{ fontSize: z.font, fontWeight: '700', color: on ? OB.acc : OB.ink }}>
        {name}
      </Text>
    </Animated.View>
  );
}

type Sim = { engine: Matter.Engine; bodies: Tagged[]; drag: Matter.Constraint | null; raf: number; running: boolean; wake: () => void };

export function GenresStep({ picked, setPicked, onNext, scale }: { picked: string[]; setPicked: (p: string[]) => void; onNext: () => void; scale: number }) {
  const reduced = useReducedMotion();
  const [box, setBox] = useState<{ w: number; h: number; top: number } | null>(null);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const measured = Object.keys(sizes).length === N;
  const pose = useSharedValue<number[]>(new Array(N * 3).fill(-10000)); // x, y, angle per pill; y < -9000 = not dropped yet
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  const toggle = (n: string) => {
    hapticTick();
    const p = pickedRef.current;
    setPicked(p.includes(n) ? p.filter((x) => x !== n) : [...p, n]);
  };

  const ws = useMemo(() => (measured ? GENRES.map((g) => sizes[g.name].w) : []), [measured, sizes]);
  const hs = useMemo(() => (measured ? GENRES.map((g) => sizes[g.name].h) : []), [measured, sizes]);

  const sim = useRef<Sim | null>(null);
  useEffect(() => {
    if (!box || !measured) return;
    const W = box.w;
    const H = box.h;
    if (reduced) {
      pose.value = rows(ws, hs, W, H);
      return;
    }
    const { Engine, Bodies, Composite, Body, Sleeping } = Matter;
    const engine = Engine.create({ enableSleeping: true });
    engine.gravity.y = 1.1;
    Composite.add(engine.world, [
      Bodies.rectangle(W / 2, H + 40, W * 3, 80, { isStatic: true }),
      Bodies.rectangle(-40, H / 2, 80, H * 6, { isStatic: true }),
      Bodies.rectangle(W + 40, H / 2, 80, H * 6, { isStatic: true }),
    ]);
    const bodies: Tagged[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const s: Sim = { engine, bodies, drag: null, raf: 0, running: false, wake: () => {} };
    const step = () => {
      Engine.update(engine, 1000 / 60);
      const out = new Array(N * 3).fill(-10000);
      let moving = s.drag != null || bodies.length < N;
      for (const b of bodies) {
        // safety net: anything that still escapes goes back on top of the pile
        if (b.position.x < -20 || b.position.x > W + 20 || b.position.y > H + 40) {
          Body.setPosition(b, { x: W / 2, y: 20 });
          Body.setVelocity(b, { x: 0, y: 0 });
        }
        out[b.idx * 3] = b.position.x;
        out[b.idx * 3 + 1] = b.position.y;
        out[b.idx * 3 + 2] = b.angle;
        if (!b.isSleeping) moving = true;
      }
      pose.value = out;
      if (moving) s.raf = requestAnimationFrame(step);
      else s.running = false; // everything is still: stop until the next touch
    };
    s.wake = () => {
      for (const b of bodies) Sleeping.set(b, false);
      if (!s.running) {
        s.running = true;
        s.raf = requestAnimationFrame(step);
      }
    };
    GENRES.forEach((_, i) => {
      const w = ws[i];
      const h = hs[i];
      timers.push(
        setTimeout(() => {
          const b = Bodies.rectangle(w / 2 + Math.random() * Math.max(1, W - w), -40 - Math.random() * 100, w, h, {
            chamfer: { radius: h / 2 - 1 },
            restitution: 0.2,
            friction: 0.5,
            angle: (Math.random() - 0.5) * 1.4,
          }) as Tagged;
          b.idx = i;
          Composite.add(engine.world, b);
          bodies.push(b);
          s.wake();
        }, 150 + i * 85)
      );
    });
    // lid at the top of the screen once everything has fallen, so a pill can't be thrown out
    timers.push(setTimeout(() => Composite.add(engine.world, Bodies.rectangle(W / 2, -box.top - 40, W * 3, 80, { isStatic: true })), 150 + N * 85 + 1200));
    sim.current = s;
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(s.raf);
      Engine.clear(engine);
      sim.current = null;
    };
  }, [box, measured, reduced, ws, hs, pose]);

  // touch: press a pill to pick it, or drag it around (a spring pulls it toward the finger)
  const touch = useRef<{ x: number; y: number; moved: boolean; idx: number } | null>(null);
  const hitAt = (x: number, y: number): number => {
    const s = sim.current;
    if (s) {
      const b = Matter.Query.point(s.bodies, { x, y })[0] as Tagged | undefined;
      return b ? b.idx : -1;
    }
    if (!reduced || !measured) return -1;
    const p = pose.value; // Reduce Motion layout: plain box test
    for (let i = 0; i < N; i++) if (Math.abs(x - p[i * 3]) < ws[i] / 2 && Math.abs(y - p[i * 3 + 1]) < hs[i] / 2) return i;
    return -1;
  };
  const onGrant = (e: GestureResponderEvent) => {
    const { locationX: x, locationY: y } = e.nativeEvent;
    const idx = hitAt(x, y);
    touch.current = idx >= 0 ? { x, y, moved: false, idx } : null;
    const s = sim.current;
    const b = s?.bodies.find((q) => q.idx === idx);
    if (s && b) {
      s.drag = Matter.Constraint.create({ pointA: { x, y }, bodyB: b, pointB: { x: x - b.position.x, y: y - b.position.y }, stiffness: 0.2, length: 0 });
      Matter.Composite.add(s.engine.world, s.drag);
      s.wake();
    }
  };
  const onMove = (e: GestureResponderEvent) => {
    const t = touch.current;
    if (!t) return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    if (Math.hypot(x - t.x, y - t.y) > 6) t.moved = true;
    const s = sim.current;
    if (s?.drag) s.drag.pointA = { x, y };
  };
  const onEnd = () => {
    const t = touch.current;
    const s = sim.current;
    if (s?.drag) {
      Matter.Composite.remove(s.engine.world, s.drag);
      s.drag = null;
      s.wake();
    }
    if (t && !t.moved) toggle(GENRES[t.idx].name);
    touch.current = null;
  };

  return (
    <View style={{ flex: 1 }}>
      <Dots at={0} />
      <Headline size={54 * scale} style={{ marginTop: 14 }}>
        {'Pick your\nfavorite\ngenres'}
      </Headline>
      <Text style={styles.sub}>Tap the ones you love. Drag them around if you want.</Text>
      <View
        style={{ flex: 1, marginHorizontal: -10, marginBottom: 12 }}
        onLayout={(e: LayoutChangeEvent) => {
          const { width, height, y } = e.nativeEvent.layout;
          if (!box || Math.abs(box.w - width) > 1 || Math.abs(box.h - height) > 1) setBox({ w: width, h: height, top: y });
        }}
        onStartShouldSetResponder={(e) => hitAt(e.nativeEvent.locationX, e.nativeEvent.locationY) >= 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onEnd}
        onResponderTerminate={onEnd}
      >
        {/* measuring pass: invisible copies tell us each pill's real size */}
        {!measured &&
          GENRES.map((g) => (
            <View
              key={g.name}
              pointerEvents="none"
              style={[styles.pill, { position: 'absolute', opacity: 0, height: SZ[g.size].h, paddingHorizontal: SZ[g.size].pad }]}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setSizes((s) => (s[g.name] ? s : { ...s, [g.name]: { w: width, h: height } }));
              }}
            >
              <Text allowFontScaling={false} style={{ fontSize: SZ[g.size].font, fontWeight: '700' }}>
                {g.name}
              </Text>
            </View>
          ))}
        {measured &&
          GENRES.map((g, i) => (
            <Pill key={g.name} i={i} name={g.name} size={g.size} w={ws[i]} h={hs[i]} pose={pose} on={picked.includes(g.name)} onToggle={() => toggle(g.name)} />
          ))}
      </View>
      <PopButton
        kind="ink"
        label={picked.length ? `Next · ${picked.length} picked` : 'Skip'}
        onPress={() => {
          appLog('ui', `welcome: picked ${picked.length} genres`);
          onNext();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { fontWeight: '700', fontSize: 15, color: OB.ink, marginTop: 12, maxWidth: 260 },
  pill: { borderWidth: 2, borderColor: OB.ink, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
