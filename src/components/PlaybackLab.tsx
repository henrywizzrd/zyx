import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AudioPlayer } from 'expo-audio';
import { getPlayer } from '../music/audioPlayer';
import { useTheme } from '../theme/ThemeProvider';
import { getAudio, searchSongs, Song } from '../music/ytmusic';

const fmt = (s?: number) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);

// Khu vực thử nghiệm: tìm bài trên YouTube Music rồi phát thử.
// Mục đích là trả lời "trong app này tìm được và nghe được không", chưa phải giao diện thật.
export function PlaybackLab() {
  const { theme } = useTheme();
  const { text, textSecondary, accent, surface } = theme.colors;

  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [busy, setBusy] = useState<'search' | 'play' | null>(null);
  const [nowId, setNowId] = useState<string | null>(null);
  const [status, setStatus] = useState({ playing: false, time: 0, duration: 0, loaded: false });
  const [logs, setLogs] = useState<string[]>([]);
  const player = useRef<AudioPlayer | null>(null);
  const lastStatus = useRef('');
  const [muxed, setMuxed] = useState(true);

  const log = useCallback((msg: string) => {
    const t = new Date().toLocaleTimeString();
    setLogs((l) => [...l.slice(-39), `${t}  ${msg}`]);
  }, []);

  useEffect(() => {
    const p = getPlayer();
    player.current = p;
    const sub = p.addListener('playbackStatusUpdate', (s) => {
      const key = `${s.playbackState}|${s.timeControlStatus}|${s.reasonForWaitingToPlay}|${s.error ?? ''}`;
      if (key !== lastStatus.current) {
        lastStatus.current = key;
        log(`Trình phát: ${s.playbackState} / ${s.timeControlStatus} / ${s.reasonForWaitingToPlay} / loaded=${s.isLoaded} dur=${Math.round(s.duration)}${s.error ? ' / LỖI ' + s.error : ''}`);
      }
      setStatus({ playing: s.playing, time: s.currentTime, duration: s.duration, loaded: s.isLoaded });
    });
    return () => {
      sub.remove();
    };
  }, [log]);

  const onSearch = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy('search');
    setSongs([]);
    try {
      setSongs(await searchSongs(q, log));
    } catch (e) {
      log(`TÌM LỖI: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const onPlay = async (song: Song) => {
    if (busy) return;
    setBusy('play');
    setNowId(song.id);
    try {
      log(`Lấy link phát: ${song.title}`);
      const audio = await getAudio(song.id, log, muxed);
      log(`Phát bằng client ${audio.client} (${audio.host})`);
      player.current?.replace({ uri: audio.url, name: song.title });
      player.current?.play();
    } catch (e) {
      log(`PHÁT LỖI: ${(e as Error)?.message ?? e}`);
    } finally {
      setBusy(null);
    }
  };

  const toggle = () => {
    const p = player.current;
    if (!p) return;
    if (status.playing) p.pause();
    else p.play();
  };

  return (
    <View style={{ marginTop: 40 }}>
      <Text style={{ color: text, fontSize: 18, fontWeight: '700' }}>Playback lab (thử nghiệm)</Text>
      <Text style={{ color: textSecondary, marginTop: 4, fontSize: 12 }}>
        Tìm một bài trên YouTube Music rồi bấm để nghe thử. Nhật ký bên dưới cho biết bước nào chạy được.
      </Text>

      <View style={[styles.row, { backgroundColor: surface }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={onSearch}
          placeholder="Tên bài hát hoặc nghệ sĩ"
          placeholderTextColor={textSecondary}
          returnKeyType="search"
          style={{ flex: 1, color: text, paddingVertical: 10 }}
        />
        <Pressable onPress={onSearch} style={[styles.btn, { backgroundColor: accent }]}>
          <Text style={{ color: '#000', fontWeight: '700' }}>Tìm</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => {
          log('Phát thử mp3 mẫu');
          player.current?.replace({ uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' });
          player.current?.play();
          setNowId('sample');
        }}
        style={{ marginTop: 10, alignSelf: 'flex-start' }}
      >
        <Text style={{ color: accent, fontWeight: '600' }}>▶ Phát thử mp3 mẫu</Text>
      </Pressable>

      <Pressable onPress={() => setMuxed((m) => !m)} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
        <Text style={{ color: accent, fontWeight: '600' }}>Kiểu link: {muxed ? 'mp4 có hình' : 'chỉ âm thanh'}</Text>
      </Pressable>

      {busy && <ActivityIndicator color={accent} style={{ marginTop: 12 }} />}

      <Pressable
        onPress={() => {
          log('Phát thử mp3 mẫu');
          player.current?.replace({ uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' });
          player.current?.play();
          setNowId('sample');
        }}
        style={{ marginTop: 10, alignSelf: 'flex-start' }}
      >
        <Text style={{ color: accent, fontWeight: '600' }}>▶ Phát thử mp3 mẫu</Text>
      </Pressable>

      {songs.map((s) => {
        const active = s.id === nowId;
        return (
          <Pressable key={s.id} onPress={() => onPlay(s)} style={styles.song}>
            {s.thumb ? (
              <Image source={{ uri: s.thumb }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, { backgroundColor: surface }]} />
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: active ? accent : text, fontWeight: '600' }}>{s.title}</Text>
              <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 12, marginTop: 2 }}>
                {s.artist}
                {s.duration ? ` • ${fmt(s.duration)}` : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}

      {nowId && (
        <View style={[styles.row, { backgroundColor: surface, marginTop: 16 }]}>
          <Pressable onPress={toggle} style={[styles.btn, { backgroundColor: text }]}>
            <Text style={{ color: '#000', fontWeight: '700' }}>{status.playing ? 'Pause' : 'Play'}</Text>
          </Pressable>
          <Text style={{ color: textSecondary, marginLeft: 12 }}>
            {status.loaded ? `${fmt(status.time)} / ${fmt(status.duration)}` : 'Đang tải...'}
          </Text>
        </View>
      )}

      <View style={[styles.logBox, { backgroundColor: surface }]}>
        <Text style={{ color: textSecondary, fontSize: 11, fontWeight: '700', marginBottom: 6 }}>NHẬT KÝ</Text>
        {logs.length === 0 ? (
          <Text style={{ color: textSecondary, fontSize: 11 }}>Chưa có gì.</Text>
        ) : (
          logs.map((l, i) => (
            <Text key={i} selectable style={{ color: text, fontSize: 11, fontFamily: 'Courier', marginBottom: 2 }}>
              {l}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingLeft: 12, paddingRight: 6, marginTop: 14 },
  btn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 16 },
  song: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6, marginTop: 4 },
  thumb: { width: 48, height: 48, borderRadius: 4 },
  logBox: { borderRadius: 8, padding: 12, marginTop: 20 },
});
