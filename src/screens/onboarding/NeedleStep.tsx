// Last welcome screen: "Drop the needle". 27/11 v2: a flat, top-down turntable (like the reference Tyson sent),
// no 3D tilt — the tilted deck kept covering the record on iOS. The record sits in its sleeve with only its top edge
// showing and gently rises to hint the gesture. One job: swipe up anywhere on the sleeve — the record slides out and
// lands on the platter, the tone arm swings onto it, it spins, then the camera dives into the label and the app opens.
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
import { EASE_IN_OUT, EASE_OUT, Hard, Headline, OB, Vinyl } from './kit';

const REC = 124; // record in the sleeve
const SLEEVE = 150;
const PEEK = 16; // how much of the record shows above the sleeve
const REC_BOTTOM = SLEEVE - REC + PEEK; // record's bottom edge, measured from the sleeve's bottom
const OUT = REC - PEEK; // rise needed to clear the sleeve
const GAP = 44; // between the turntable and the sleeve
const ARM_REST = 6; // tone arm angles, degrees (0 = pointing straight down)
const ARM_PLAY = 30;

export function NeedleStep({ onDone, scale }: { onDone: () => void; scale: number }) {
  const reduced = useReducedMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [touched, setTouched] = useState(false);
  const [landed, setLanded] = useState(false);

  // geometry, in this screen's coordinates
  const W = box?.w ?? 0;
  const H = box?.h ?? 0;
  const top = 150 * scale; // below the headline and the line under it
  const D = Math.max(200, Math.min(W, 340, H - SLEEVE - GAP - top)); // square turntable
  const deckX = (W - D) / 2;
  const deckY = H - SLEEVE - GAP - D;
  const P = D * 0.78; // platter
  const platCx = deckX + D * 0.45;
  const platCy = deckY + D * 0.5;
  const disc = P * 0.94; // record on the platter
  const recCy = H - REC_BOTTOM - REC / 2;
  // tone arm: pivot near the top right corner, rod hanging down along the right side
  const pivX = deckX + D * 0.86;
  const pivY = deckY + D * 0.15;
  const armLen = D * 0.6;

  const ty = useSharedValue(0);
  const tx = useSharedValue(0);
  const sc = useSharedValue(1);
  const bob = useSharedValue(0);
  const arm = useSharedValue(ARM_REST);
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
    arm.value = withDelay(200, withTiming(ARM_PLAY, { duration: 700, easing: EASE_OUT }));
    if (reduced) {
      setTimeout(onDone, 900);
      return;
    }
    zoom.value = withDelay(1250, withTiming(6, { duration: 1250, easing: EASE_IN_OUT }));
    setTimeout(onDone, 1250 + 800); // the lime flash (drawn by AuthGate) covers the rest of the dive
  };

  const targetX = platCx - W / 2;
  const targetY = platCy - recCy;
  const targetS = disc / REC;
  const fly = (from: number) => {
    'worklet';
    busy.value = 1;
    const first = from > -OUT ? 200 : 0; // still in the sleeve: finish pulling it out first
    ty.value = withSequence(
      withTiming(-OUT - 8, { duration: first }),
      withTiming(targetY, { duration: 560, easing: EASE_OUT }, (done) => {
        if (done) scheduleOnRN(afterLanding);
      })
    );
    tx.value = withDelay(first, withTiming(targetX, { duration: 560, easing: EASE_OUT }));
    sc.value = withDelay(first, withTiming(targetS, { duration: 560, easing: EASE_OUT }));
  };

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
      if (-ty.value > 60 || e.velocityY < -600) fly(ty.value);
      else ty.value = withSpring(0, { duration: 400, dampingRatio: 0.8, velocity: e.velocityY });
    },
  });

  const recStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value + bob.value }, { scale: sc.value }] }));
  const armStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${arm.value}deg` }] }));
  const worldStyle = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));
  const fade = useAnimatedStyle(() => ({ opacity: zoom.value > 1.05 ? 0 : 1 }));

  return (
    <View style={{ flex: 1 }} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: `${platCx}px ${platCy}px` }, worldStyle]}>
        <Headline size={52 * scale} style={{ marginTop: 4 }}>
          {'Drop the\nneedle'}
        </Headline>
        <Text style={styles.sub}>Swipe the record up to start.</Text>

        {box && (
          <>
            {/* turntable, seen from above */}
            <Hard radius={D * 0.08} offset={6} outer={{ position: 'absolute', left: deckX, top: deckY }} style={{ width: D, height: D, borderRadius: D * 0.08, borderWidth: 3, backgroundColor: OB.paper }} />
            <View pointerEvents="none" style={[styles.platter, { left: platCx - P / 2, top: platCy - P / 2, width: P, height: P, borderRadius: P / 2 }]}>
              {landed ? <Vinyl size={disc} spin={1600} border={2} /> : <View style={styles.spindle} />}
            </View>
            {/* start lever, bottom left, and speed knob, bottom right */}
            <View pointerEvents="none" style={[styles.lever, { left: deckX + D * 0.06, top: deckY + D * 0.74, width: D * 0.05, height: D * 0.16, borderRadius: D * 0.03 }]} />
            <View pointerEvents="none" style={[styles.knob, { left: deckX + D * 0.84, top: deckY + D * 0.8, width: D * 0.09, height: D * 0.09, borderRadius: D * 0.05 }]} />
            {/* tone arm: hangs from the pivot; turns onto the record once it lands */}
            <Animated.View
              pointerEvents="none"
              style={[{ position: 'absolute', left: pivX - 8, top: pivY, width: 16, height: armLen + 24, transformOrigin: '8px 0px' }, armStyle]}
            >
              <View style={{ position: 'absolute', left: 5, top: 0, width: 6, height: armLen, borderRadius: 3, backgroundColor: OB.ink }} />
              <View style={{ position: 'absolute', left: 0, top: armLen - 4, width: 16, height: 26, borderRadius: 4, backgroundColor: OB.ink }} />
            </Animated.View>
            <View pointerEvents="none" style={[styles.pivot, { left: pivX - D * 0.07, top: pivY - D * 0.07, width: D * 0.14, height: D * 0.14, borderRadius: D * 0.07 }]}>
              <View style={{ width: D * 0.05, height: D * 0.05, borderRadius: D * 0.025, backgroundColor: OB.ink }} />
            </View>

            {/* the record, behind the sleeve until it rises out of it */}
            {!landed && (
              <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: W / 2 - REC / 2, top: recCy - REC / 2 }, recStyle]}>
                <Vinyl size={REC} />
              </Animated.View>
            )}
            <Animated.View pointerEvents="none" style={[styles.sleeve, { left: W / 2 - SLEEVE / 2 }, fade]}>
              <View style={[StyleSheet.absoluteFill, { left: 5, top: 5, right: -5, bottom: -5, borderRadius: 14, backgroundColor: OB.ink }]} />
              <View style={styles.sleeveFace}>
                <Text allowFontScaling={false} style={styles.sleeveText}>
                  {'Your\nfirst\nrecord'}
                </Text>
              </View>
            </Animated.View>
            {!touched && (
              <View pointerEvents="none" style={[styles.hint, { left: W / 2 + SLEEVE / 2 + 8, bottom: SLEEVE / 2 - 18 }]}>
                <Text style={styles.hintText}>↑ Swipe</Text>
              </View>
            )}
            {/* touch area: the whole sleeve plus the record above it */}
            <GestureDetector gesture={pan}>
              <View
                accessible
                accessibilityRole="button"
                accessibilityLabel="Put the record on the turntable"
                onAccessibilityTap={() => fly(0)}
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
  platter: { position: 'absolute', backgroundColor: '#2A2A2E', borderWidth: 3, borderColor: OB.ink, alignItems: 'center', justifyContent: 'center' },
  spindle: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#CCCCCC', borderWidth: 2, borderColor: OB.ink },
  lever: { position: 'absolute', backgroundColor: OB.ink },
  knob: { position: 'absolute', backgroundColor: OB.acc, borderWidth: 3, borderColor: OB.ink },
  pivot: { position: 'absolute', backgroundColor: OB.acc, borderWidth: 3, borderColor: OB.ink, alignItems: 'center', justifyContent: 'center' },
  sleeve: { position: 'absolute', bottom: 0, width: SLEEVE, height: SLEEVE },
  sleeveFace: { flex: 1, borderRadius: 14, backgroundColor: OB.acc, borderWidth: 3, borderColor: OB.ink, justifyContent: 'flex-end', padding: 12 },
  sleeveText: { fontFamily: CONDENSED_FONT, fontWeight: 'normal', fontSize: 26, lineHeight: 25, color: OB.ink, textTransform: 'uppercase', includeFontPadding: false },
  hint: { position: 'absolute', backgroundColor: OB.ink, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  hintText: { color: OB.acc, fontWeight: '900', fontSize: 13 },
});
