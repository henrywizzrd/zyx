import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { useScreenSize } from './ScreenSize';

export type CropRect = { originX: number; originY: number; width: number; height: number };

const MAX_ZOOM = 5;
const SIDE = 16; // lề hai bên khung cắt
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Màn hình cắt ảnh bìa: khung cố định đúng tỉ lệ vùng ảnh bìa, ảnh nằm dưới khung.
//  - một ngón: kéo ảnh
//  - hai ngón: chụm / mở để thu phóng
// Ảnh luôn phủ kín khung (không kéo hở ra ngoài được). Bấm Xong thì trả về vùng cắt tính theo pixel của ảnh gốc.
export function CoverCropper({
  uri,
  imageWidth,
  imageHeight,
  aspect,
  onCancel,
  onDone,
}: {
  uri: string;
  imageWidth: number;
  imageHeight: number;
  aspect: number; // rộng / cao của khung
  onCancel: () => void;
  onDone: (rect: CropRect) => Promise<void> | void;
}) {
  const { theme } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const win = useScreenSize();
  const [busy, setBusy] = useState(false);

  const fw = win.width - SIDE * 2;
  const fh = fw / aspect;
  const minScale = Math.max(fw / imageWidth, fh / imageHeight); // vừa đủ phủ kín khung
  // Ảnh được dựng ở cỡ vừa phủ khung (không dựng cỡ gốc vài nghìn px), phóng to thêm bằng scale tương đối
  const dw = imageWidth * minScale;
  const dh = imageHeight * minScale;

  // Trạng thái hiện tại: tỉ lệ phóng và độ lệch tâm ảnh so với tâm khung (đơn vị: điểm màn hình)
  const st = useRef({ s: minScale, tx: 0, ty: 0 });
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  const apply = (s: number, x: number, y: number) => {
    s = clamp(s, minScale, minScale * MAX_ZOOM);
    const mx = Math.max(0, (imageWidth * s - fw) / 2);
    const my = Math.max(0, (imageHeight * s - fh) / 2);
    x = clamp(x, -mx, mx);
    y = clamp(y, -my, my);
    st.current = { s, tx: x, ty: y };
    scale.setValue(s / minScale);
    tx.setValue(x);
    ty.setValue(y);
  };

  // Mốc lúc bắt đầu một cử chỉ (đổi số ngón giữa chừng thì lấy mốc mới)
  const base = useRef({ s: 0, tx: 0, ty: 0, dist: 0, mx: 0, my: 0, n: 0 });
  const begin = (touches: { pageX: number; pageY: number }[]) => {
    const [a, b] = touches;
    base.current = {
      ...st.current,
      n: touches.length,
      dist: b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0,
      mx: b ? (a.pageX + b.pageX) / 2 : a.pageX,
      my: b ? (a.pageY + b.pageY) / 2 : a.pageY,
    };
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => begin(e.nativeEvent.touches as any),
        onPanResponderMove: (e) => {
          const touches = e.nativeEvent.touches as any as { pageX: number; pageY: number }[];
          if (!touches.length) return;
          if (touches.length !== base.current.n) return begin(touches);
          const b = base.current;
          if (touches.length >= 2) {
            const [p, q] = touches;
            const dist = Math.hypot(p.pageX - q.pageX, p.pageY - q.pageY);
            const mx = (p.pageX + q.pageX) / 2;
            const my = (p.pageY + q.pageY) / 2;
            const k = b.dist > 0 ? dist / b.dist : 1;
            // Phóng quanh tâm khung, cộng thêm phần dịch theo trung điểm hai ngón
            apply(b.s * k, b.tx * k + (mx - b.mx), b.ty * k + (my - b.my));
          } else {
            const p = touches[0];
            apply(b.s, b.tx + (p.pageX - b.mx), b.ty + (p.pageY - b.my));
          }
        },
      }),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const done = async () => {
    const { s, tx: x, ty: y } = st.current;
    // Góc trên trái khung, tính trong toạ độ ảnh gốc
    const originX = clamp((imageWidth * s) / 2 - fw / 2 - x, 0, imageWidth * s) / s;
    const originY = clamp((imageHeight * s) / 2 - fh / 2 - y, 0, imageHeight * s) / s;
    const width = Math.min(fw / s, imageWidth - originX);
    const height = Math.min(fh / s, imageHeight - originY);
    setBusy(true);
    try {
      await onDone({ originX: Math.round(originX), originY: Math.round(originY), width: Math.floor(width), height: Math.floor(height) });
    } finally {
      setBusy(false);
    }
  };

  // Vị trí khung trên màn hình
  const top = (win.height - fh) / 2;
  const dim = 'rgba(0,0,0,0.6)';

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel} supportedOrientations={['portrait']}>
      <View style={{ flex: 1, backgroundColor: '#000000' }} {...pan.panHandlers}>
        {/* Ảnh: tâm ảnh đặt ở tâm khung rồi dịch / phóng theo cử chỉ */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: SIDE + fw / 2 - dw / 2,
            top: top + fh / 2 - dh / 2,
            width: dw,
            height: dh,
            transform: [{ translateX: tx }, { translateY: ty }, { scale }],
          }}
        >
          <Image source={{ uri }} style={{ width: dw, height: dh }} />
        </Animated.View>

        {/* Làm tối phần ngoài khung */}
        <View pointerEvents="none" style={[styles.dim, { top: 0, left: 0, right: 0, height: top, backgroundColor: dim }]} />
        <View pointerEvents="none" style={[styles.dim, { top: top + fh, left: 0, right: 0, bottom: 0, backgroundColor: dim }]} />
        <View pointerEvents="none" style={[styles.dim, { top, left: 0, width: SIDE, height: fh, backgroundColor: dim }]} />
        <View pointerEvents="none" style={[styles.dim, { top, right: 0, width: SIDE, height: fh, backgroundColor: dim }]} />
        <View pointerEvents="none" style={[styles.dim, { top, left: SIDE, width: fw, height: fh, borderWidth: 2, borderColor: '#FFFFFF', borderRadius: 4 }]} />

        {/* Thanh trên: Huỷ / tiêu đề / Xong */}
        <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onCancel} hitSlop={10} disabled={busy}>
            <Text style={styles.barBtn}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={styles.barTitle}>{t('crop.title')}</Text>
          <Pressable onPress={done} hitSlop={10} disabled={busy}>
            {busy ? <ActivityIndicator color={theme.colors.accent} /> : <Text style={[styles.barBtn, { color: theme.colors.accent }]}>{t('common.done')}</Text>}
          </Pressable>
        </View>
        <Text pointerEvents="none" style={[styles.hint, { bottom: insets.bottom + 28 }]}>{t('crop.hint')}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  barBtn: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  barTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  hint: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: 13 },
});
