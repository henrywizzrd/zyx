import React, { useEffect } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

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

// Bản sao đứng yên của nền chung, đặt bên trong trang đang được vuốt quay lại: trang trượt đi nhưng nền vẫn
// giữ nguyên chỗ (màu nền, ảnh, cảnh trời sao), không còn bị thay bằng một mảng màu trơn.
// live: chỉ bật lúc trang đang trượt (không chạy hiệu ứng thứ hai suốt lúc trang đứng yên cho đỡ tốn pin).
// Video thì không phát bản thứ hai (tốn pin): dùng lớp phủ tối / sáng như trước.
const scene = Platform.OS === 'web' ? null : (require('../theme/effects/Ambient') as typeof import('../theme/effects/Ambient'));
export function PageBackdrop({ live = false }: { live?: boolean }) {
  const { theme } = useTheme();
  const { type, uri, dim } = theme.background;
  const media = type !== 'preset' && !!uri;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.background.color }]}>
      {media && type === 'image' && <AppBackground />}
      {media && type === 'video' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg, opacity: Math.max(0.85, 1 - dim * 0.2) }]} />
      )}
      {scene && !media && <scene.ThemeScene />}
      {/* Đang vuốt: chạy cả hiệu ứng (sao băng, hoa rơi...) theo cùng đồng hồ với nền chung nên khớp nhau */}
      {scene && live && <scene.AmbientEffect />}
    </View>
  );
}
