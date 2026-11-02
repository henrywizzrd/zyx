import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, GestureStateManager, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { QueueItem, usePlayer } from '../player/PlayerProvider';
import { Cover } from './Cover';
import { Reorderable } from './Reorderable';
import { ReorderableScrollView } from './ReorderableScrollView';

const SOFT = 'rgba(255,255,255,0.6)';
const PAD = 16;
const ROW_H = 60; // mỗi bài trong hàng đợi cao đúng chừng này (ảnh 48 + đệm 6 trên dưới)

// Lò xo mềm, không nảy quá đà: mở / kéo lên xem hết / thả về đều trượt êm
const SPRING = { damping: 32, stiffness: 210, mass: 1, overshootClamping: true };

// Tấm "Hàng đợi" trượt lên từ dưới trong màn hình player (giống Spotify).
//  - Mở ra: chỉ cao nửa màn hình. Vuốt lên để xem hết, vuốt xuống để thu lại / đóng
//  - Nền kính trong suốt hơi mờ, vẫn nhìn thấy player phía sau
//  - Bấm một bài: phát bài đó. Nhấn giữ rồi kéo: đổi thứ tự. Nút ✕: bỏ khỏi hàng đợi. Bấm ra ngoài: đóng
// Toàn bộ chuyển động chạy trên UI thread (Reanimated + Gesture Handler) nên ngón tay kéo tới đâu tấm theo tới đó, không khựng.
// Tấm được dựng sẵn ngay từ đầu (nằm dưới đáy, ẩn) nên bấm mở là danh sách đã có, không bị hiện khung trống rồi mới hiện bài.
export function QueueSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { queue, index, jumpTo, removeFromQueue, reorderUpNext, autoplay, setAutoplay, radioLoading } = usePlayer();
  const accent = theme.colors.accent;

  const [box, setBox] = useState({ width: 0, height: 0 });
  // Tấm luôn cao gần hết màn hình, chỉ trượt lên xuống:
  //  y = 0 → mở hết, y = HALF → mở một nửa, y = CLOSED → đóng (nằm dưới đáy)
  const sheetH = Math.max(0, box.height - insets.top - 12);
  const CLOSED = sheetH + 40;
  const HALF = Math.max(0, sheetH - Math.round(box.height * 0.5));

  const y = useSharedValue(100000);
  const half = useSharedValue(HALF);
  const closed = useSharedValue(CLOSED);
  const isFull = useSharedValue(false);
  const [full, setFull] = useState(false); // chỉ dùng để bật cuộn danh sách khi đã mở hết
  const listY = useSharedValue(0); // vị trí cuộn của danh sách (0 = đang ở trên cùng)
  // Dựng sẵn tấm sau khi player đã mở xong (dựng ngay lúc mở player sẽ làm hiệu ứng phóng to bị khựng).
  // Bấm Queue trước lúc đó thì dựng luôn
  const [armed, setArmed] = useState(visible);
  useEffect(() => {
    if (visible) return setArmed(true);
    const id = setTimeout(() => setArmed(true), 900);
    return () => clearTimeout(id);
  }, [visible]);
  // Lớp kính mờ chỉ có khi tấm đang mở (để ẩn dưới đáy vẫn tốn máy, nhất là lúc player phóng to / thu nhỏ)
  const [glass, setGlass] = useState(visible);

  useEffect(() => {
    half.value = HALF;
    closed.value = CLOSED;
  }, [HALF, CLOSED]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mở: từ đáy trượt lên nửa màn hình. Đóng: trượt hẳn xuống
  useEffect(() => {
    if (!sheetH) return;
    if (visible) {
      isFull.value = false;
      setFull(false);
      setGlass(true);
      y.value = CLOSED;
      y.value = withSpring(HALF, SPRING);
    } else {
      isFull.value = false;
      setFull(false);
      y.value = withTiming(CLOSED, { duration: 260, easing: Easing.out(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(setGlass, false);
      });
    }
  }, [visible, sheetH]); // eslint-disable-line react-hooks/exhaustive-deps

  const enableScrollLater = () => setTimeout(() => setFull(true), 280);

  // Kéo tấm (chạy trên UI thread). Thả ra: dạt về vị trí gần nhất, tính cả đà vuốt
  const start = useSharedValue(0);
  const onBegin = () => {
    'worklet';
    start.value = y.value;
  };
  const onUpdate = (e: { translationY: number }) => {
    'worklet';
    const v = start.value + e.translationY;
    // Kéo quá mức mở hết thì chỉ nhích nhẹ (cảm giác dây chun)
    y.value = v < 0 ? v * 0.2 : v;
  };
  const onDeactivate = (e: { translationY: number; velocityY: number }) => {
    'worklet';
    const h = half.value;
    const c = closed.value;
    const p = start.value + e.translationY + e.velocityY * 0.12;
    if (p > (h + c) / 2) {
      scheduleOnRN(onClose);
      return;
    }
    const toFull = p < h / 2;
    isFull.value = toFull;
    y.value = withSpring(toFull ? 0 : h, { ...SPRING, velocity: e.velocityY });
    // Mở hết rồi mới cho cuộn danh sách (bật giữa chừng làm danh sách vẽ lại khi đang trượt → khựng)
    if (!toFull) scheduleOnRN(setFull, false);
    else scheduleOnRN(enableScrollLater);
  };

  // Thanh trên cùng: lúc nào cũng kéo được
  const headerPan = usePanGesture({ activeOffsetY: [-6, 6], onBegin, onUpdate, onDeactivate });
  // Cả tấm:
  //  - đang mở một nửa: vuốt dọc ở đâu cũng là kéo tấm
  //  - đang mở hết: danh sách đang ở trên cùng mà vuốt xuống → kéo tấm xuống (thu lại / đóng),
  //    còn lại (vuốt lên, hoặc danh sách đang cuộn giữa chừng) là cuộn danh sách như thường
  //  - giữ lâu một bài (đổi thứ tự) hoặc vuốt ngang thì tấm đứng yên
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const reordering = useSharedValue(false);
  const bodyPan = usePanGesture({
    manualActivation: true,
    onTouchesDown: (e) => {
      const tt = e.changedTouches[0];
      if (!tt) return;
      sx.value = tt.absoluteX;
      sy.value = tt.absoluteY;
    },
    onTouchesMove: (e) => {
      const tt = e.allTouches[0];
      if (!tt) return;
      const dx = tt.absoluteX - sx.value;
      const dy = tt.absoluteY - sy.value;
      if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) return GestureStateManager.fail(e.handlerTag);
      // Đang nhấc một bài lên để đổi thứ tự: để yên cho việc kéo bài
      if (reordering.value) return GestureStateManager.fail(e.handlerTag);
      const atTop = isFull.value && listY.value <= 1;
      if (Math.abs(dy) < (atTop ? 5 : 8)) return;
      if (!isFull.value || (dy > 0 && atTop)) GestureStateManager.activate(e.handlerTag);
      else GestureStateManager.fail(e.handlerTag);
    },
    onBegin,
    onUpdate,
    onDeactivate,
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, Math.max(1, half.value), closed.value], [0.35, 0.18, 0], 'clamp'),
  }));
  const upNext = useMemo(() => queue.slice(index + 1).map((q) => ({ id: q.qid, item: q })), [queue, index]);
  const listW = Math.max(0, Math.min(box.width, 520) - PAD * 2);

  const row = (q: QueueItem, current: boolean) => (
    <View style={styles.row}>
      <Cover track={q} style={{ width: 48, height: 48, borderRadius: 4 }}>
        <Ionicons name="musical-notes" size={18} color="rgba(255,255,255,0.8)" />
      </Cover>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: current ? accent : '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
          {q.title}
        </Text>
        <Text numberOfLines={1} style={{ color: SOFT, fontSize: 13, marginTop: 2 }}>
          {q.auto ? '✦ ' : ''}
          {q.artist}
        </Text>
      </View>
    </View>
  );

  const current = queue[index] as QueueItem | undefined;
  if (!armed) return <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setBox(e.nativeEvent.layout)} />;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      {/* Phủ tối rất nhẹ phía sau, bấm vào để đóng */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, backdropStyle]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      <GestureDetector gesture={bodyPan}>
      <Animated.View style={[styles.sheet, { height: sheetH, width: Math.min(box.width, 520) }, sheetStyle]}>
        {/* Kính trong suốt, mờ nhẹ phần player phía sau */}
        {!glass ? null : Platform.OS === 'ios' ? (
          <>
            <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,20,20,0.32)' }]} />
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(22,22,22,0.86)' }]} />
        )}
        <View pointerEvents="none" style={styles.edge} />
        {/* Thanh trên: kéo lên / xuống */}
        <GestureDetector gesture={headerPan}>
        <View collapsable={false} style={{ paddingHorizontal: PAD, paddingBottom: 8 }}>
          <View style={styles.grab} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{t('queue.title')}</Text>
            <Text style={{ color: SOFT, fontSize: 13, fontWeight: '600', marginRight: 8 }}>{t('queue.autoplay')}</Text>
            <Switch value={autoplay} onValueChange={setAutoplay} trackColor={{ true: accent, false: '#3A3A3A' }} />
          </View>
        </View>
        </GestureDetector>

        <ReorderableScrollView scrollEnabled={full} scrollYOut={listY} reorderingOut={reordering} contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: insets.bottom + 32 }}>
          <Text style={styles.section}>{t('queue.nowPlaying')}</Text>
          {current ? row(current, true) : <Text style={{ color: SOFT }}>{t('queue.nothing')}</Text>}

          <Text style={[styles.section, { marginTop: 20 }]}>{t('queue.next')}</Text>
          {upNext.length === 0 && !radioLoading && (
            <Text style={{ color: SOFT, fontSize: 14 }}>
              {t(autoplay ? 'queue.endAuto' : 'queue.end')}
            </Text>
          )}
          {listW > 0 && upNext.length > 0 && (
            <Reorderable
              key={`${Math.round(listW)}`}
              data={upNext}
              enabled
              columns={1}
              cellWidth={listW}
              gapX={0}
              gapY={2}
              onReorder={reorderUpNext}
              estimatedHeight={ROW_H}
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Pressable style={{ flex: 1 }} onPress={() => jumpTo(item.qid)}>
                    {row(item, false)}
                  </Pressable>
                  <Pressable onPress={() => removeFromQueue(item.qid)} hitSlop={10} style={{ padding: 6 }}>
                    <Ionicons name="close" size={20} color={SOFT} />
                  </Pressable>
                </View>
              )}
            />
          )}
          {radioLoading && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <ActivityIndicator color={SOFT} />
              <Text style={{ color: SOFT, fontSize: 13 }}>{t('queue.finding')}</Text>
            </View>
          )}
          {upNext.some((x) => x.item.auto) && (
            <Text style={{ color: SOFT, fontSize: 12, marginTop: 14 }}>{t('queue.note')}</Text>
          )}
        </ReorderableScrollView>
      </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  edge: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 8, marginBottom: 12 },
  section: { color: SOFT, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
});
