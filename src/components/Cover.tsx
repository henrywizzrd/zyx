import React from 'react';
import { Image, StyleProp, View, ViewStyle } from 'react-native';
import type { Track } from '../data/mock';

// Link ảnh YouTube có đoạn =w120-h120 (hoặc =s120). Đặt w và h bằng nhau thì server tự cắt giữa thành hình vuông.
export function bigThumb(url: string, size: number) {
  return url.replace(/=(w\d+-h\d+|s\d+)/, `=w${size}-h${size}`);
}

// Ảnh bìa của bài đang phát: có ảnh thì hiện ảnh, chưa có thì hiện màu nền + children (icon).
export function Cover({ track, size, style, children }: { track: Track; size?: number; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const uri = track.thumb && size ? bigThumb(track.thumb, size) : track.thumb;
  return (
    <View style={[{ backgroundColor: track.color, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>
      {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: '100%', height: '100%' }} /> : children}
    </View>
  );
}
