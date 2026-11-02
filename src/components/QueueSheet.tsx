import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, PanResponder, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useT } from '../i18n';
import { QueueItem, usePlayer } from '../player/PlayerProvider';
import { Cover } from './Cover';
import { Reorderable } from './Reorderable';
import { ReorderableScrollView } from './ReorderableScrollView';

const USE_NATIVE = Platform.OS !== 'web';
const SOFT = 'rgba(255,255,255,0.6)';
const PAD = 16;

// Tấm "Hàng đợi" trượt lên từ dưới trong màn hình player (giống Spotify).
//  - Bấm một bài: phát bài đó
//  - Nhấn giữ rồi kéo: đổi thứ tự
//  - Nút ✕: bỏ khỏi hàng đợi
//  - Vuốt thanh trên cùng xuống, hoặc bấm ra ngoài: đóng
export function QueueSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { theme } = useTheme();
  const t = useT();
  const { queue, index, track, jumpTo, removeFromQueue, reorderUpNext, autoplay, setAutoplay, radioLoading } = usePlayer();
  const accent = theme.colors.accent;

  const [box, setBox] = useState({ width: 0, height: 0 });
  const sheetH = Math.round(box.height * 0.88);

  // 0 = đóng (nằm dưới đáy), 1 = mở
  const shown = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current; // kéo thanh trên xuống
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) setMounted(true);
    drag.setValue(0);
    Animated.timing(shown, {
      toValue: visible ? 1 : 0,
      duration: visible ? 280 : 220,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: USE_NATIVE,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, shown, drag]);

  const close = useRef(onClose);
  close.current = onClose;
  const headerPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 90 || g.vy > 0.8) close.current();
          else Animated.timing(drag, { toValue: 0, duration: 160, useNativeDriver: USE_NATIVE }).start();
        },
        onPanResponderTerminate: () => Animated.timing(drag, { toValue: 0, duration: 160, useNativeDriver: USE_NATIVE }).start(),
      }),
    [drag]
  );

  const upNext = useMemo(() => queue.slice(index + 1).map((q) => ({ id: q.qid, item: q })), [queue, index]);
  const listW = Math.max(0, Math.min(box.width, 520) - PAD * 2);

  const translateY = Animated.add(shown.interpolate({ inputRange: [0, 1], outputRange: [sheetH || 2000, 0] }), drag);

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

  if (!mounted) return <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setBox(e.nativeEvent.layout)} />;

  const current = queue[index] as QueueItem | undefined;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'} onLayout={(e) => setBox(e.nativeEvent.layout)}>
      {/* Nền tối phía sau, bấm vào để đóng */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: shown }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.sheet,
          { height: sheetH, width: Math.min(box.width, 520), backgroundColor: '#161616', transform: [{ translateY }] },
        ]}
      >
        {/* Thanh trên: kéo xuống để đóng */}
        <View {...headerPan.panHandlers} style={{ paddingHorizontal: PAD, paddingBottom: 8 }}>
          <View style={styles.grab} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{t('queue.title')}</Text>
            <Text style={{ color: SOFT, fontSize: 13, fontWeight: '600', marginRight: 8 }}>{t('queue.autoplay')}</Text>
            <Switch value={autoplay} onValueChange={setAutoplay} trackColor={{ true: accent, false: '#3A3A3A' }} />
          </View>
        </View>

        <ReorderableScrollView contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: 32 }}>
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
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 8, marginBottom: 12 },
  section: { color: SOFT, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
});
