import React, { useEffect } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme/ThemeProvider';
import { AmbientSnow } from './AmbientSnowLayer';

// Nền chung của cả app, nằm sau mọi màn hình (trừ Player):
//  - 'preset': màu nền của bộ màu
//  - 'image': ảnh hoặc GIF (expo-image tự chạy GIF)
//  - 'video': video lặp, không tiếng
// Phủ thêm một lớp tối (theme tối) hoặc sáng (theme sáng) theo "độ tối nền" để chữ luôn đọc được.
export function AppBackground() {
  const { theme } = useTheme();
  const { type, uri, dim } = theme.background;
  if (type === 'preset' || !uri) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {type === 'video' ? <VideoBg uri={uri} /> : <ImageBg uri={uri} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.glassTint === 'dark' ? `rgba(0,0,0,${dim})` : `rgba(255,255,255,${dim})` }]} />
    </View>
  );
}

function ImageBg({ uri }: { uri: string }) {
  const { Image } = require('expo-image') as typeof import('expo-image');
  return <Image source={{ uri }} contentFit="cover" style={StyleSheet.absoluteFill} transition={250} />;
}

function VideoBg({ uri }: { uri: string }) {
  const { useVideoPlayer, VideoView } = require('expo-video') as typeof import('expo-video');
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    // Trộn chung, không giành âm thanh: nhạc đang phát không bị dừng vì video nền
    p.audioMixingMode = 'mixWithOthers';
    p.showNowPlayingNotification = false;
    p.staysActiveInBackground = false;
    p.play();
  });
  // Ra khỏi app thì dừng video cho đỡ tốn pin, quay lại thì chạy tiếp
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      try {
        if (s === 'active') player.play();
        else player.pause();
      } catch {}
    });
    return () => sub.remove();
  }, [player]);
  return <VideoView player={player} contentFit="cover" nativeControls={false} style={StyleSheet.absoluteFill} />;
}

// Nền cho trang mở chồng (playlist, album...):
//  - nền theo bộ màu: màu đặc
//  - nền ảnh/GIF: vẽ lại đúng ảnh nền chung (ảnh đã có sẵn trong bộ nhớ nên rất nhẹ)
//  - nền video: kính mờ dày phủ lên màn hình phía dưới (không mở thêm một video thứ hai)
export function PageBackground() {
  const { theme } = useTheme();
  const { type, uri } = theme.background;
  if (type === 'preset' || !uri) {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg }]}>
        <AmbientSnow />
      </View>
    );
  }
  if (type === 'image') {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg }]}>
        <AppBackground />
        <AmbientSnow />
      </View>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      {Platform.OS !== 'web' && <BlurView intensity={90} tint={theme.colors.glassTint} style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.glass }]} />
      <AmbientSnow />
    </View>
  );
}
