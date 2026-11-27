// Last welcome screen: "Drop the needle". The record sits in its sleeve with only its top edge showing and gently
// rises to hint the gesture. One job: swipe up anywhere on the sleeve — the record slides out, flies onto the
// tilted turntable, the arm swings in, then the camera dives into the label and the app opens.
import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { hapticSnap } from '../../components/haptics';
import { CONDENSED_FONT } from '../../theme/fonts';
import { EASE_IN_OUT, EASE_OUT, Headline, OB, Vinyl } from './kit';

const REC = 124; // record in the sleeve
const SLEEVE = 150;
const PEEK = 16; // how much of the record shows above the sleeve
const REC_BOTTOM = SLEEVE - REC + PEEK; // record's bottom edge, measured from the sleeve's bottom
const OUT = REC - PEEK; // rise needed to clear the sleeve
const TILT = 52; // turntable tilt, degrees
const COS = Math.cos((TILT * Math.PI) / 180);
// Turntable drawn at 300×250; platter 200 wide at (24, 22)
const DECK_W = 300;
const DECK_H = 250;
const PLAT = { x: 24, y: 22, d: 200 };

export function NeedleStep({ onDone, scale }: { onDone: () => void; scale: number }) {
  const reduced = useReducedMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [touched, setTouched] = useState(false);
  const [landed, setLanded] = useState(false);

  // geometry (all in this screen's coordinates)
  const W = box?.w ?? 0;
  const H = box?.h ?? 0;
  const k = Math.min(W * 0.82, 270) / DECK_W; // turntable scale
  const dw = DECK_W * k;
  const dh = DECK_H * k;
  const deckCx = W / 2;
  const deckCy = H - SLEEVE - 36 - (dh * COS) / 2 - 14 * k;
  const platCx = deckCx + (PLAT.x + PLAT.d / 2 - DECK_W / 2) * k;
  const platCy = deckCy + (PLAT.y + PLAT.d / 2 - DECK_H / 2) * k * COS;
  const recCy = H - REC_BOTTOM - REC / 2;

  // record motion
  const ty = useSharedValue(0);
  const tx = useSharedValue(0);
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const bob = useSharedValue(0);
  const arm = useSharedValue(8);
  const zoom = useSharedValue(1);
  const busy = useSharedValue(0);

  useEffect(() => {
    if (reduced || touched) return;
    bob.value = withRepeat(withSequence(withTiming(-22, { duration: 550, easing: EASE_OUT }), withTiming(0, { duration: 550, easing: EASE_IN_OUT }), withTiming(0, { duration: 1100 })), -1, false);
    return () => cancelAnimation(bob);
  }, [reduced, touched, bob]);

  const afterLanding = () => {
    setLanded(true);
    hapticSnap();
    arm.value = withDelay(250, withTiming(24, { duration: 700, easing: EASE_OUT }));
    if (reduced) {
      setTimeout(onDone, 900);
      return;
    }
    zoom.value = withDelay(1250, withTiming(6, { duration: 1250, easing: EASE_IN_OUT }));
    setTimeout(onDone, 1250 + 800); // the lime flash (drawn by AuthGate) covers the rest of the dive
  };

  const fly = (targetX: number, targetY: number, scaleX: number, scaleY: number, from: number) => {
    'worklet';
    busy.value = 1;
    const first = from > -OUT ? 220 : 0; // still in the sleeve: finish pulling it out first
    ty.value = withSequence(withTiming(-OUT - 8, { duration: first }), withTiming(targetY, { duration: 560, easing: EASE_OUT }, (done) => {
      if (done) scheduleOnRN(afterLanding);
    }));
    tx.value = withDelay(first, withTiming(targetX, { duration: 560, easing: EASE_OUT }));
    sx.value = withDelay(first, withTiming(scaleX, { duration: 560, easing: EASE_OUT }));
    sy.value = withDelay(first, withTiming(scaleY, { duration: 560, easing: EASE_OUT }));
  };

  const targetX = platCx - W / 2;
  const targetY = platCy - recCy;
  const scaleX = (PLAT.d * k * 0.96) / REC;
  const scaleY = (PLAT.d * k * COS * 0.96) / REC;
  const pan = usePanGesture({
    activeOffsetY: [-4, 4],
    onBegin: () => {
      'worklet';
      if (busy.value) return;
      cancelAnimation(bob);
      bob.value = withTiming(0, { duration: 150 });
      scheduleOnRN(setTouched, true);
    },
    onUpdate: (e) => {
      'worklet';
      if (busy.value) return;
      // straight up only; pulling down gives a little resistance
      ty.value = e.translationY < 0 ? e.translationY : e.translationY * 0.15;
    },
    onDeactivate: (e) => {
      'worklet';
      if (busy.value) return;
      if (-ty.value > 60 || e.velocityY < -600) fly(targetX, targetY, scaleX, scaleY, ty.value);
      else ty.value = withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: e.velocityY });
    },
  });

  const recStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value + bob.value }, { scaleX: sx.value }, { scaleY: sy.value }],
  }));
  const armStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${arm.value}deg` }] }));
  const worldStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));
  const sleeveStyle = useAnimatedStyle(() => ({ opacity: zoom.value > 1.05 ? 0 : 1 }));

  const deckTransform = [{ perspective: 900 }, { rotateX: `${TILT}deg` }];
  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: `${platCx}px ${platCy}px` }, worldStyle]}>
        <Headline size={52 * scale} style={{ marginTop: 4 }}>
          {'Drop the\nneedle'}
        </Headline>
        <Text style={styles.sub}>Swipe the record up to start.</Text>

        {box && (
          <>
            {/* turntable: a solid base under the tilted deck gives it thickness */}
            <View pointerEvents="none" style={{ position: 'absolute', left: deckCx - dw / 2, top: deckCy - dh / 2 + 14 * k, width: dw, height: dh, borderRadius: 26 * k, backgroundColor: OB.ink, transform: deckTransform }} />
            <View pointerEvents="none" style={[styles.deck, { left: deckCx - dw / 2, top: deckCy - dh / 2, width: dw, height: dh, borderRadius: 26 * k, transform: deckTransform }]}>
              <View style={{ position: 'absolute', left: PLAT.x * k, top: PLAT.y * k, width: PLAT.d * k, height: PLAT.d * k, borderRadius: PLAT.d, backgroundColor: '#2A2A2E', borderWidth: 3, borderColor: OB.ink, alignItems: 'center', justifyContent: 'center' }}>
                {landed ? <Vinyl size={PLAT.d * k - 10} spin={1600} border={2} /> : <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#CCCCCC', borderWidth: 2, borderColor: OB.ink }} />}
              </View>
              {/* tone arm, pivoting at its top */}
              <Animated.View style={[{ position: 'absolute', right: 20 * k, top: 24 * k, width: 16 * k, height: 150 * k, alignItems: 'center', transformOrigin: 'top' }, armStyle]}>
                <View style={{ width: 16 * k, height: 16 * k, borderRadius: 8 * k, backgroundColor: OB.ink }} />
                <View style={{ width: 6 * k, height: 112 * k, backgroundColor: OB.ink, borderRadius: 3 }} />
                <View style={{ width: 12 * k, height: 18 * k, backgroundColor: OB.ink, borderRadius: 3, marginLeft: -6 * k }} />
              </Animated.View>
              <View style={{ position: 'absolute', right: 22 * k, bottom: 18 * k, width: 34 * k, height: 34 * k, borderRadius: 17 * k, backgroundColor: OB.acc, borderWidth: 3, borderColor: OB.ink }} />
            </View>

            {/* the record (behind the sleeve until it rises out of it) */}
            {!landed && (
              <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: W / 2 - REC / 2, top: recCy - REC / 2 }, recStyle]}>
                <Vinyl size={REC} />
              </Animated.View>
            )}
            <Animated.View pointerEvents="none" style={[styles.sleeve, { left: W / 2 - SLEEVE / 2 }, sleeveStyle]}>
              <View style={[StyleSheet.absoluteFill, { left: 5, top: 5, right: -5, bottom: -5, borderRadius: 14, backgroundColor: OB.ink }]} />
              <View style={styles.sleeveFace}>
                <Text allowFontScaling={false} style={styles.sleeveText}>
                  {'Your\nfirst\nrecord'}
                </Text>
              </View>
            </Animated.View>
            {!touched && (
              <View pointerEvents="none" style={[styles.hint, { right: 0, bottom: SLEEVE + 38 }]}>
                <Text style={styles.hintText}>↑ Swipe up</Text>
              </View>
            )}
            {/* touch area: the whole sleeve plus the record above it */}
            <GestureDetector gesture={pan}>
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel="Put the record on the turntable"
                onAccessibilityTap={() => fly(targetX, targetY, scaleX, scaleY, 0)}
                style={{ position: 'absolute', left: W / 2 - 90, bottom: 0, width: 180, height: SLEEVE + 70 }}
              />
            </GestureDetector>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { fontWeight: '700', fontSize: 15, color: OB.ink, marginTop: 10 },
  deck: { position: 'absolute', backgroundColor: OB.paper, borderWidth: 3, borderColor: OB.ink, overflow: 'hidden' },
  sleeve: { position: 'absolute', bottom: 0, width: SLEEVE, height: SLEEVE },
  sleeveFace: { flex: 1, borderRadius: 14, backgroundColor: OB.acc, borderWidth: 3, borderColor: OB.ink, justifyContent: 'flex-end', padding: 12 },
  sleeveText: { fontFamily: CONDENSED_FONT, fontWeight: 'normal', fontSize: 26, lineHeight: 25, color: OB.ink, textTransform: 'uppercase', includeFontPadding: false },
  hint: { position: 'absolute', backgroundColor: OB.ink, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  hintText: { color: OB.acc, fontWeight: '900', fontSize: 14 },
});
