import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMyFollowers, type FollowerPeek } from '../data/community';
import { useSession } from '../data/auth';
import { useNav } from '../nav/Nav';
import { log as appLog } from '../data/applog';

// Faces of the 3 newest followers next to my name in Library (27/11, replaces the mock T M K L).
// From the 4th follower on, a "…" bubble stands for the rest (a followers list will open from it later).
// Tap a face to open that person's profile. Nothing is shown for guests or when nobody follows yet.
let cached: FollowerPeek | null = null; // keeps the faces while the app is open, so Library doesn't flash on return

export function FollowerStack({ size = 30, ring, textColor = '#FFFFFF' }: { size?: number; ring: string; textColor?: string }) {
  const session = useSession();
  const { push } = useNav();
  const [peek, setPeek] = useState<FollowerPeek | null>(cached);
  const accountId = session?.mode === 'account' ? session.id ?? null : null;

  useEffect(() => {
    if (!accountId) {
      cached = null;
      setPeek(null);
      return;
    }
    let alive = true;
    getMyFollowers(3)
      .then((p) => {
        cached = p;
        if (alive) setPeek(p);
      })
      .catch((e) => appLog('ui', `followers failed to load: ${String(e?.message ?? e)}`));
    return () => {
      alive = false;
    };
  }, [accountId]);

  if (!peek || !peek.recent.length) return null;
  const face = { width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: ring };
  return (
    <View style={{ flexDirection: 'row' }}>
      {peek.recent.map((f, i) => (
        <Pressable
          key={f.id}
          onPress={() => push({ type: 'user', id: f.id })}
          hitSlop={4}
          style={[styles.face, face, { backgroundColor: f.color, marginLeft: i === 0 ? 0 : -size * 0.28, zIndex: 10 - i }]}
        >
          {f.avatar ? (
            <Image source={{ uri: f.avatar }} style={StyleSheet.absoluteFill} />
          ) : (
            <Text style={{ color: '#FFFFFF', fontSize: size * 0.4, fontWeight: '800' }}>{(f.name || '?').slice(0, 1).toUpperCase()}</Text>
          )}
        </Pressable>
      ))}
      {peek.total > peek.recent.length && (
        <View style={[styles.face, face, { backgroundColor: 'rgba(0,0,0,0.45)', marginLeft: -size * 0.28 }]}>
          <Ionicons name="ellipsis-horizontal" size={size * 0.5} color={textColor} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  face: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
