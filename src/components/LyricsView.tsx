import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, ScrollViewInstance, Text, View } from 'react-native';
import type { Lyrics } from '../music/lyrics';

function currentIndex(lyrics: Lyrics, progress: number) {
  let cur = -1;
  for (let i = 0; i < lyrics.lines.length; i++) {
    if ((lyrics.lines[i].t ?? Infinity) <= progress + 0.25) cur = i;
    else break;
  }
  return cur;
}

export function LyricsView({
  status,
  lyrics,
  progress,
  onSeek,
}: {
  status: 'idle' | 'loading' | 'done';
  lyrics: Lyrics | null;
  progress: number;
  onSeek: (seconds: number) => void;
}) {
  const scroll = useRef<ScrollViewInstance>(null);
  const ys = useRef<number[]>([]);
  const last = useRef(lyrics);
  const [h, setH] = useState(0);
  if (last.current !== lyrics) {
    last.current = lyrics;
    ys.current = [];
  }
  const cur = lyrics?.synced ? currentIndex(lyrics, progress) : -1;

  // Dòng đang hát tự cuộn lên gần đầu khung
  useEffect(() => {
    if (cur < 0 || !h) return;
    const y = ys.current[cur];
    if (y == null) return;
    scroll.current?.scrollTo({ y: Math.max(0, y - h * 0.25), animated: true });
  }, [cur, h]);

  if (status === 'loading' || status === 'idle') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#FFFFFF" />
      </View>
    );
  }
  if (!lyrics) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16 }}>Chưa tìm thấy lời cho bài này.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scroll}
      bounces={false}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      onLayout={(e) => setH(e.nativeEvent.layout.height)}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: 24, paddingBottom: h * 0.6 }}
    >
      {lyrics.lines.map((l, i) => {
        const onLayout = (e: any) => (ys.current[i] = e.nativeEvent.layout.y);
        if (!l.text) return <View key={i} onLayout={onLayout} style={{ height: 22 }} />;
        const active = lyrics.synced ? i === cur : true;
        return (
          <Pressable
            key={i}
            onLayout={onLayout}
            disabled={l.t == null}
            onPress={() => l.t != null && onSeek(l.t)}
            style={{ paddingVertical: 6 }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 30, lineHeight: 38, fontWeight: '800', opacity: active ? 1 : 0.35 }}>
              {l.text}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
