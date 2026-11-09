// Bộ icon cho dock kiểu Apple Music (theo mẫu Tyson gửi): nhà nét viền, thư viện đặc có nốt nhạc khoét rỗng,
// cài đặt là ô vuông bo góc có hai thanh trượt, kính lúp nét dày.
// Tất cả vẽ trong khung 24×24 rồi CÂN THỊ GIÁC: hình đặc / nét dày trông "nặng" và to hơn hình nét mảnh cùng kích thước,
// nên mỗi icon có hệ số thu nhỏ riêng (scale) để đứng cạnh nhau trông đều nhau; icon thu nhỏ vẫn nằm giữa khung.
import React from 'react';
import { Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VectorIcon, type VectorOp } from './VectorIcon';
import type { TabId } from '../theme/types';

type Id = Exclude<TabId, 'player'>;
const ICONS: Record<Id, { scale: number; ops: VectorOp[] }> = {
  home: {
    scale: 1,
    ops: [{ d: 'M12 2.8 L19.3 8.6 Q20.25 9.35 20.25 10.7 V20.25 H14.25 V15.2 Q14.25 14.25 13.3 14.25 H10.7 Q9.75 14.25 9.75 15.2 V20.25 H3.75 V10.7 Q3.75 9.35 4.7 8.6 Z', stroke: 2 }],
  },
  library: {
    scale: 0.9, // khối đặc → nhỏ lại để không lấn các icon nét
    ops: [
      { d: 'M7.4 2.5 Q12 1.7 16.6 2.5', stroke: 1.8 },
      { d: 'M5.6 5.1 Q12 4.1 18.4 5.1', stroke: 1.8 },
      { d: 'M4.3 7.6 Q12 6.4 19.7 7.6 Q21.6 7.9 21.85 10 Q22.5 14.5 21.85 19 Q21.6 21.1 19.7 21.4 Q12 22.6 4.3 21.4 Q2.4 21.1 2.15 19 Q1.5 14.5 2.15 10 Q2.4 7.9 4.3 7.6 Z', fill: true },
      { circle: [9.5, 17.1, 2.4], clear: true },
      { d: 'M10.95 17 V10.7', stroke: 1.75, clear: true },
      { d: 'M11.3 10.4 L15.3 11.6', stroke: 2.4, clear: true },
    ],
  },
  settings: {
    scale: 0.97,
    ops: [
      { d: 'M8 3.75 H16 Q20.25 3.75 20.25 8 V16 Q20.25 20.25 16 20.25 H8 Q3.75 20.25 3.75 16 V8 Q3.75 3.75 8 3.75 Z', stroke: 1.9 },
      { d: 'M7.6 9.5 H12.6', stroke: 1.9 },
      { circle: [14.7, 9.5, 1.75], stroke: 1.7 },
      { d: 'M11.4 14.5 H16.4', stroke: 1.9 },
      { circle: [9.3, 14.5, 1.75], stroke: 1.7 },
    ],
  },
  search: {
    scale: 0.93, // nét dày → nhỏ lại chút
    ops: [
      { circle: [10.2, 10.2, 6.4], stroke: 2.7 },
      { d: 'M15 15 L20.6 20.6', stroke: 2.9 },
    ],
  },
};
const FALLBACK: Record<Id, keyof typeof Ionicons.glyphMap> = { home: 'home-outline', library: 'library', settings: 'options-outline', search: 'search' };

// size: khung chung cho mọi icon; icon "nặng" tự nhỏ lại bên trong khung
export function DockGlyph({ id, size, color }: { id: Id; size: number; color: string }) {
  const ic = ICONS[id];
  const s = Math.round(size * ic.scale);
  if (Platform.OS === 'web') return <Ionicons name={FALLBACK[id]} size={s} color={color} />;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <VectorIcon ops={ic.ops} box={24} size={s} color={color} fallback={<Ionicons name={FALLBACK[id]} size={s} color={color} />} />
    </View>
  );
}
