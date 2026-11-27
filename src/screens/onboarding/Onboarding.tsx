// Welcome screens after sign-in (27/11): genres → what's inside → pick your look → drop the needle.
// Shown once per device to people who arrive at the sign-in screen without a saved session (new installs).
// English only. preview: opened from the admin screen; nothing is saved or applied.
import React, { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { kvSet } from '../../data/db';
import { log as appLog } from '../../data/applog';
import { useTheme } from '../../theme/ThemeProvider';
import { OB } from './kit';
import { GenresStep } from './GenresStep';
import { InsideStep } from './InsideStep';
import { LookChoice, LookStep } from './LookStep';
import { NeedleStep } from './NeedleStep';

export const ONBOARDED_KEY = 'zyx.onboarded';
export const FAV_GENRES_KEY = 'zyx.favGenres';

// Full-screen lilac frame shared with the sign-in screen: safe areas, a centred column on wide screens
export function WelcomeFrame({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: OB.bg }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 16) + 8, paddingHorizontal: 22 }}>
        {children}
      </View>
    </View>
  );
}

// Headline size: designed for a 390 pt wide, 844 pt tall phone; smaller phones scale down, never up
export function useWelcomeScale() {
  const { width, height } = useWindowDimensions();
  return Math.max(0.72, Math.min(1, Math.min(width, 480) / 390, height / 844));
}

export function Onboarding({ onDone, preview }: { onDone: () => void; preview?: boolean }) {
  const { theme, setStyle, setPop, setPreset, setDockMode } = useTheme();
  const scale = useWelcomeScale();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [look, setLook] = useState<LookChoice>({ kind: 'pop', theme: 'lilac' });

  const finish = () => {
    if (!preview) {
      if (look.kind === 'pop') {
        setStyle('pop');
        setPop({ theme: look.theme, followSystem: false });
      } else {
        setStyle('glass');
        setPreset(look.preset, false);
      }
      if (theme.dock.mode !== 'apple') setDockMode('apple');
      kvSet(FAV_GENRES_KEY, picked);
      kvSet(ONBOARDED_KEY, true);
    }
    appLog('ui', `welcome done${preview ? ' (preview)' : ''}: ${look.kind === 'pop' ? `Pop ${look.theme}` : `Default ${look.preset}`}, ${picked.length} genres`);
    onDone();
  };

  return (
    <WelcomeFrame>
      <Animated.View key={step} entering={FadeInRight.duration(350)} exiting={FadeOutLeft.duration(200)} style={{ flex: 1 }}>
        {step === 0 && <GenresStep picked={picked} setPicked={setPicked} onNext={() => setStep(1)} scale={scale} />}
        {step === 1 && <InsideStep onBack={() => setStep(0)} onNext={() => setStep(2)} scale={scale} />}
        {step === 2 && <LookStep look={look} setLook={setLook} onBack={() => setStep(1)} onNext={() => setStep(3)} scale={scale} />}
        {step === 3 && <NeedleStep onDone={finish} scale={scale} />}
      </Animated.View>
    </WelcomeFrame>
  );
}
