import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { usePlayer } from '../player/PlayerProvider';
import { useContentInsets } from '../components/FloatingDock';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function NowPlayingScreen() {
  const { theme } = useTheme();
  const pad = useContentInsets();
  const { track, isPlaying, progress, togglePlay, next, prev } = usePlayer();
  const pct = Math.min(1, progress / track.duration);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingTop: pad.top + 24,
        paddingLeft: pad.left + 24,
        paddingRight: pad.right + 24,
      }}
    >
      <View style={[styles.cover, { backgroundColor: track.color }]}>
        <Ionicons name="musical-notes" size={64} color="rgba(255,255,255,0.8)" />
      </View>

      <View style={styles.column}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>{track.title}</Text>
        <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontSize: 15 }}>{track.artist}</Text>

        <View style={[styles.bar, { backgroundColor: '#333333' }]}>
          <View style={{ width: `${pct * 100}%`, height: 4, borderRadius: 2, backgroundColor: theme.colors.text }} />
        </View>
        <View style={styles.times}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{fmt(progress)}</Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{fmt(track.duration)}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable onPress={prev}>
            <Ionicons name="play-skip-back" size={30} color={theme.colors.text} />
          </Pressable>
          <Pressable onPress={togglePlay} style={styles.playBtn}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color="#000000" />
          </Pressable>
          <Pressable onPress={next}>
            <Ionicons name="play-skip-forward" size={30} color={theme.colors.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { width: '100%', maxWidth: 360, aspectRatio: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  column: { width: '100%', maxWidth: 360, marginTop: 28 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 4 },
  bar: { height: 4, borderRadius: 2, marginTop: 24 },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, paddingHorizontal: 24 },
  playBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
});