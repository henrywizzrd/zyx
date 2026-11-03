import React, { useState } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import type { Track } from '../data/mock';

// Ảnh video YouTube: i.ytimg.com/vi/<id>/<tên>.jpg (default, mqdefault, hqdefault, sddefault...)
const YT_VIDEO = /^(https?:\/\/i\d?\.ytimg\.com\/vi(?:_webp)?\/[^/]+)\/[^/?]+\.(?:jpg|webp)(?:\?.*)?$/;

// Các link ảnh nên thử, tốt nhất trước. Ảnh nào lỗi (video không có bản đó) thì Cover tự chuyển sang link sau.
export function thumbCandidates(url: string, size: number): string[] {
  const m = url.match(YT_VIDEO);
  if (m) {
    const base = m[1].replace('/vi_webp/', '/vi/');
    // hq720 và maxresdefault là ảnh 16:9 không viền đen, cắt vuông vẫn nét. hqdefault luôn có nhưng nhỏ và có viền đen.
    // Ảnh nhỏ: dùng mqdefault (16:9, không có viền đen) thay vì hqdefault (4:3, có 2 viền đen trên dưới)
    return size >= 300
      ? [`${base}/hq720.jpg`, `${base}/maxresdefault.jpg`, `${base}/hqdefault.jpg`]
      : [`${base}/mqdefault.jpg`, `${base}/hq720.jpg`, `${base}/hqdefault.jpg`];
  }
  // Ảnh YouTube Music có đoạn =w120-h120 (hoặc =s120). Đặt w và h bằng nhau thì server tự cắt giữa thành hình vuông.
  if (/=(w\d+-h\d+|s\d+)/.test(url)) return [url.replace(/=(w\d+-h\d+|s\d+)/, `=w${size}-h${size}`), url];
  return [url];
}

export function bigThumb(url: string, size: number) {
  return thumbCandidates(url, size)[0];
}

// Tải trước ảnh (ví dụ ảnh các playlist của trang vừa tải xong) vào bộ nhớ đệm của expo-image
export function prefetchThumbs(urls: (string | undefined)[], size: number) {
  const list = urls.filter((u): u is string => !!u).map((u) => thumbCandidates(u, size)[0]);
  if (list.length) Image.prefetch(list, 'memory-disk').catch(() => {});
}

// Ảnh có dự phòng: link đầu lỗi thì thử link sau.
// Dùng expo-image: lưu ảnh vào bộ nhớ + ổ đĩa (mở lại trang / mở lại app là hiện ngay, không tải lại),
// giải mã ảnh ở luồng nền, và hiện mờ dần thay vì bật ra
export function SmartImage({ url, size, style, blurRadius }: { url: string; size: number; style?: any; blurRadius?: number }) {
  const list = thumbCandidates(url, size);
  const [state, setState] = useState({ url, i: 0 });
  const i = state.url === url ? state.i : 0; // đổi bài thì bắt đầu lại từ link tốt nhất
  return (
    <Image
      source={{ uri: list[Math.min(i, list.length - 1)] }}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={160}
      recyclingKey={url}
      blurRadius={blurRadius}
      style={style}
      onError={() => i < list.length - 1 && setState({ url, i: i + 1 })}
    />
  );
}

// Ảnh bìa của bài đang phát: có ảnh thì hiện ảnh, chưa có thì hiện màu nền + children (icon).
export function Cover({ track, size, style, children }: { track: Track; size?: number; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  return (
    <View style={[{ backgroundColor: track.color, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>
      {track.thumb ? (
        size ? (
          <SmartImage url={track.thumb} size={size} style={{ width: '100%', height: '100%' }} />
        ) : (
          <Image source={{ uri: track.thumb }} contentFit="cover" cachePolicy="memory-disk" style={{ width: '100%', height: '100%' }} />
        )
      ) : (
        children
      )}
    </View>
  );
}
