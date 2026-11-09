import React, { useMemo } from 'react';
import { Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICONS } from './FloatingDock';
import type { TabId } from '../theme/types';
import { DockGlyph } from './DockIcons';

const skia = Platform.OS === 'web' ? null : (require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia'));

// Đĩa than (hệ toạ độ 24×24): đĩa đặc, một rãnh mảnh, lỗ giữa — các vòng khoét bằng luật tô chẵn lẻ
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
const DISC = circle(10.5, 13.5, 9.2) + circle(10.5, 13.5, 6.6) + circle(10.5, 13.5, 6.0) + circle(10.5, 13.5, 1.7);
// Cần đĩa: trục ở góc trên phải, thân cần chéo xuống, đầu kim ghim vào đĩa
const ARM = 'M20.6 2.6L17.6 12.2L14.6 14.2';

// Biểu tượng đĩa nhạc có cần đĩa (giống icon app, chỉ đĩa + cần) cho tab Cài đặt
export function VinylIcon({ size, color }: { size: number; color: string }) {
  const paths = useMemo(() => {
    if (!skia) return null;
    const disc = skia.Skia.Path.MakeFromSVGString(DISC);
    const arm = skia.Skia.Path.MakeFromSVGString(ARM);
    if (!disc || !arm) return null;
    return { disc, arm };
  }, []);
  if (!skia || !paths) return <Ionicons name="disc" size={size} color={color} />;
  return (
    <skia.Canvas style={{ width: size, height: size }}>
      <skia.Group transform={[{ scale: size / 24 }]}>
        <skia.Path path={paths.disc} fillType="evenOdd" color={color} />
        {/* khoét một đường hở quanh cần đĩa (trong suốt) để cần tách khỏi mặt đĩa, như icon app */}
        <skia.Path path={paths.arm} style="stroke" strokeWidth={4} strokeCap="round" strokeJoin="round" color="black" blendMode="clear" />
        <skia.Path path={paths.arm} style="stroke" strokeWidth={1.9} strokeCap="round" strokeJoin="round" color={color} />
        <skia.Circle cx={20.6} cy={2.9} r={1.9} color={color} />
      </skia.Group>
    </skia.Canvas>
  );
}

// Icon tab cho mọi kiểu dock: dùng chung bộ icon kiểu Apple Music (DockIcons) để dock thanh / bubble / Apple Music giống nhau
export function TabIcon({ id, size, color }: { id: Exclude<TabId, 'player'>; size: number; color: string }) {
  return <DockGlyph id={id} size={size} color={color} />;
}
