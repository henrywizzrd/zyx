import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { syncSession, useSession } from '../data/auth';
import { kvGet, kvSet } from '../data/db';
import { syncProfile } from '../data/profile';
import { syncPosts } from '../data/social';
import { AuthScreen } from './AuthScreen';
import { OB } from './onboarding/kit';
import { Onboarding, ONBOARDED_KEY } from './onboarding/Onboarding';

// Preview of the welcome screens from the admin screen (nothing is signed in/out or saved)
let openPreview: (() => void) | null = null;
export function previewWelcome() {
  openPreview?.();
}

// Not signed in (first launch, or just signed out): sign-in screen first, then the app.
// 27/11: people who reach the sign-in screen on a device that has never finished the welcome screens see them once
// (genres, what's inside, pick your look, drop the needle). Already signed-in people who update never see them.
// "entered" covers the case where the session can't be saved (e.g. web without SQLite): still let them in this time.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [entered, setEntered] = useState(false);
  const [needWelcome] = useState(() => !session && !kvGet<boolean>(ONBOARDED_KEY));
  const [welcome, setWelcome] = useState(false); // showing the welcome screens after sign-in
  const [preview, setPreview] = useState<'auth' | 'intro' | null>(null);
  const [flash, setFlash] = useState(false); // lime flash fading out over the app after "drop the needle"
  useEffect(() => {
    if (session && !needWelcome && !kvGet<boolean>(ONBOARDED_KEY)) kvSet(ONBOARDED_KEY, true); // existing users
  }, [session, needWelcome]);
  useEffect(() => {
    openPreview = () => setPreview('auth');
    return () => {
      openPreview = null;
    };
  }, []);
  useEffect(() => {
    if (!session) setEntered(false); // just signed out
  }, [session]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 80);
    return () => clearTimeout(id);
  }, [flash]);
  // App start: check the session with the server (expired / signed out elsewhere → back to the sign-in screen)
  useEffect(() => {
    syncSession().then(() => {
      syncProfile();
      syncPosts();
    });
  }, []);
  // Just signed in / switched account: fetch that account's profile and posts
  const accountId = session?.mode === 'account' ? session.id : undefined;
  useEffect(() => {
    if (!accountId) return;
    syncProfile();
    syncPosts();
  }, [accountId]);

  const endWelcome = () => {
    setWelcome(false);
    setPreview(null);
    setFlash(true);
  };

  if (!session && !entered)
    return (
      <AuthScreen
        onDone={() => {
          setEntered(true);
          if (needWelcome && !kvGet<boolean>(ONBOARDED_KEY)) setWelcome(true);
        }}
      />
    );
  if (welcome) return <Onboarding onDone={endWelcome} />;
  return (
    <View style={{ flex: 1 }}>
      <Animated.View entering={FadeIn.duration(350)} style={{ flex: 1 }}>
        {children}
      </Animated.View>
      {/* admin preview: drawn over the app so the app keeps its place underneath */}
      {preview && (
        <Animated.View entering={FadeIn.duration(250)} style={StyleSheet.absoluteFill}>
          {preview === 'auth' ? <AuthScreen preview onDone={() => setPreview('intro')} /> : <Onboarding preview onDone={endWelcome} />}
        </Animated.View>
      )}
      {flash && <Animated.View pointerEvents="none" exiting={FadeOut.duration(550)} style={[StyleSheet.absoluteFill, { backgroundColor: OB.acc }]} />}
    </View>
  );
}
