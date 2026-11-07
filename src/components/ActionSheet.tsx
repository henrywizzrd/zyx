import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated as RNAnimated, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../theme/ThemeProvider';
import { StringKey, useT } from '../i18n';
import { getToastImpl, setToastImpl } from './toastBridge';
import type { Track } from '../data/mock';
import { usePlayerPick } from '../player/PlayerProvider';
import { useNav } from '../nav/Nav';
import { addToPlaylist, createPlaylist, getPlaylists, playlistHas, useDbVersion } from '../data/db';
import { download, removeDownload, useDownloads } from '../data/downloads';
import { musicSupported, ytmusic } from '../music/lazy';
import { useScreenSize } from './ScreenSize';
import { playerProgress } from './PlayerTransition';
const ORIENTATIONS = ['portrait', 'landscape-left', 'landscape-right'] as const;
import { openComposer } from './PostComposer';

// Bảng thao tác của app (thay cho action sheet / hộp thoại của iOS):
//  - nút ... của bài hát: chia sẻ, thêm vào Thư viện, thêm vào playlist, phát tiếp, thêm vào hàng chờ, tải về, xem nghệ sĩ
//  - nút ... của album / playlist (trang danh sách bài)
// Tấm kính bo góc nổi ở đáy màn hình (giống Spotify), vuốt xuống hoặc bấm ra ngoài để đóng.
// "Thêm vào playlist" và "Playlist mới" mở ngay trong tấm, không bật popup khác.

type IconName = React.ComponentProps<typeof Ionicons>['name'];
export type SheetAction = {
  label: string;
  icon: IconName;
  run: () => void | Promise<void>;
  on?: boolean; // đang bật: icon màu nhấn
  busy?: boolean; // đang chạy: hiện vòng xoay thay icon
  destructive?: boolean;
  keepOpen?: boolean; // bấm xong không đóng tấm
};
// Giữ tương thích với chỗ cũ truyền thêm lựa chọn riêng (ví dụ "Xoá khỏi playlist")
export type ExtraAction = { label: string; run: () => void; destructive?: boolean; icon?: IconName };
type Header = { title: string; subtitle?: string; thumb?: string; icon?: IconName; round?: boolean };

type Content =
  | { kind: 'song'; track: Track; extra: ExtraAction[] }
  | { kind: 'actions'; header: Header; actions: SheetAction[] }
  | { kind: 'playlists'; track: Track }
  | { kind: 'input'; title: string; initial: string; placeholder: string; submit: string; onSubmit: (v: string) => void };

type Ctx = {
  openSong: (track: Track, extra?: ExtraAction[]) => void;
  openActions: (header: Header, actions: SheetAction[]) => void;
  openInput: (o: { title: string; initial?: string; placeholder?: string; submit?: string; onSubmit: (v: string) => void }) => void;
  toast: (msg: string) => void;
};
const SheetContext = createContext<Ctx | null>(null);
// Bảng đang hiện hay không (tách riêng để các màn hình khác không phải vẽ lại mỗi lần mở / đóng bảng)
const SheetOpenContext = createContext(false);
export const useSheetOpen = () => useContext(SheetOpenContext);
export const useActionSheet = () => {
  const c = useContext(SheetContext);
  if (!c) throw new Error('useActionSheet must be used inside ActionSheetProvider');
  return c;
};

const SPRING = { damping: 30, stiffness: 260, mass: 1, overshootClamping: true };
const DANGER = '#FF453A';

// Tách tên nghệ sĩ chính ("A, B", "A & B", "A feat. B", "A x B" → "A")
const mainArtist = (s: string) => s.split(/,|&| feat\.? | ft\.? | x | và /i)[0].trim();

export function ActionSheetProvider({ children, closePlayer }: { children: React.ReactNode; closePlayer?: () => void }) {
  const { theme } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useScreenSize();
  // Màn hình ngang: bảng hẹp lại (nằm giữa, không phủ hết bề ngang) và phần nội dung cuộn được trong chiều cao còn lại
  const landscape = winW > winH;
  const bodyMax = Math.max(150, Math.min(winH * 0.5, winH - insets.top - insets.bottom - 150)); // khoảng nửa màn hình, không che hết
  const { liked, toggleLike, playNext, addToQueue } = usePlayerPick('liked', 'toggleLike', 'playNext', 'addToQueue');
  const { push } = useNav();
  const dlState = useDownloads();
  useDbVersion(); // playlist đổi thì vẽ lại (dấu tích, số bài)
  // Mở từ trong player: kính mờ tối giống bảng hàng chờ (chữ trắng), thay vì màu theo theme
  const [dark, setDark] = useState(false);
  const colors = useMemo(
    () =>
      dark
        ? { ...theme.colors, text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.62)', border: 'rgba(255,255,255,0.14)', surface: 'rgba(255,255,255,0.1)' }
        : theme.colors,
    [dark, theme.colors]
  );
  const { text, textSecondary, accent, border, surface, glassRgb, glassTint } = colors;

  const [content, setContent] = useState<Content | null>(null);
  const [shown, setShown] = useState(false); // đang mở (khác với content: content còn giữ trong lúc trượt xuống)
  const [busyArtist, setBusyArtist] = useState(false);
  const cardH = useSharedValue(600);
  const y = useSharedValue(2000);

  // ---- Mở / đóng
  const mountedRef = useRef(false); // tấm đang có trên màn hình (kể cả lúc đang trượt xuống)
  mountedRef.current = !!content;
  const present = useCallback(
    (c: Content) => {
      if (!mountedRef.current) setDark(playerProgress.value > 0.5);
      setContent(c);
      setShown(true);
      if (mountedRef.current) y.value = withSpring(0, SPRING); // đang đóng dở mà mở lại: kéo lên luôn
      else y.value = 2000; // chưa có: chờ đo chiều cao rồi trượt lên (onCardLayout)
    },
    [y]
  );
  const unmount = useCallback(() => {
    setContent(null);
    setBusyArtist(false);
  }, []);
  const close = useCallback(() => {
    setShown(false);
    y.value = withTiming(cardH.value + 60, { duration: 240, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) scheduleOnRN(unmount);
    });
  }, [y, cardH, unmount]);

  // Card vừa đo xong chiều cao lần đầu: trượt lên từ đáy
  const onCardLayout = (h: number) => {
    const first = y.value >= 1999;
    cardH.value = h;
    if (first) {
      y.value = h + 40;
      y.value = withSpring(0, SPRING);
    }
  };

  // ---- Thông báo nhỏ (toast)
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastA = useRef(new RNAnimated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback(
    (msg: string) => {
      setToastMsg(msg);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      RNAnimated.timing(toastA, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      toastTimer.current = setTimeout(() => {
        RNAnimated.timing(toastA, { toValue: 0, duration: 260, useNativeDriver: true }).start(({ finished }) => finished && setToastMsg(null));
      }, 1800);
    },
    [toastA]
  );
  useEffect(() => () => void (toastTimer.current && clearTimeout(toastTimer.current)), []);
  useEffect(() => {
    // Cho PlayerProvider (nằm ngoài tấm này) hiện thông báo nhỏ
    const fn = (key: StringKey) => toast(t(key));
    setToastImpl(fn);
    return () => {
      if (getToastImpl() === fn) setToastImpl(null);
    };
  }, [toast, t]);

  // ---- Các việc của một bài hát
  const goArtist = async (track: Track) => {
    if (!musicSupported) return;
    setBusyArtist(true);
    try {
      const name = mainArtist(track.artist);
      const r = await ytmusic().searchMusic(name, 'artist');
      const list = r.artists;
      const hit = list.find((a) => a.title.toLowerCase() === name.toLowerCase()) ?? list[0];
      if (!hit) throw new Error('not found');
      close();
      closePlayer?.();
      push({ type: 'artist', id: hit.id, name: hit.title, thumb: hit.thumb });
    } catch {
      setBusyArtist(false);
      toast(t('toast.artistNotFound'));
    }
  };

  const songActions = (track: Track, extra: ExtraAction[]): SheetAction[] => {
    const isLiked = liked.has(track.id);
    const dl = dlState(track.id);
    return [
      {
        label: t('sheet.share'),
        icon: 'share-outline',
        run: () => {
          Share.share({ message: `${track.title} - ${track.artist}\nhttps://music.youtube.com/watch?v=${track.id}` }).catch(() => {});
        },
      },
      {
        // Mở màn soạn bài, bài hát đã được đính kèm sẵn
        label: t('sheet.postToProfile'),
        icon: 'create-outline',
        run: () => {
          setTimeout(() => openComposer({ kind: 'song', id: track.id, title: track.title, subtitle: track.artist, thumb: track.thumb, source: 'yt', track }), 250);
        },
      },
      {
        label: t(isLiked ? 'sheet.removeLibrary' : 'sheet.addLibrary'),
        icon: isLiked ? 'checkmark-circle' : 'add-circle-outline',
        on: isLiked,
        run: () => {
          toggleLike(track.id, track);
          toast(t(isLiked ? 'toast.unliked' : 'toast.liked'));
        },
      },
      {
        label: t('sheet.addPlaylist'),
        icon: 'albums-outline',
        keepOpen: true,
        run: () => setContent({ kind: 'playlists', track }),
      },
      {
        label: t('menu.playNext'),
        icon: 'play-forward-circle-outline',
        run: () => {
          playNext(track);
          toast(t('toast.next'));
        },
      },
      {
        label: t('menu.addQueue'),
        icon: 'list-outline',
        run: () => {
          addToQueue(track);
          toast(t('toast.queued'));
        },
      },
      {
        label: t(dl === 'done' ? 'sheet.downloaded' : dl === 'downloading' ? 'sheet.downloading' : 'sheet.download'),
        icon: dl === 'done' ? 'arrow-down-circle' : 'arrow-down-circle-outline',
        on: dl === 'done',
        busy: dl === 'downloading',
        run: () => {
          if (dl === 'downloading') return;
          if (dl === 'done') {
            removeDownload(track);
            toast(t('toast.downloadRemoved'));
            return;
          }
          // Tải chạy nền: đóng tấm luôn, xong thì báo
          download(track).then((ok) => toast(ok ? t('toast.downloaded', { title: track.title }) : t('toast.downloadFailed')));
        },
      },
      {
        label: t('sheet.goArtist'),
        icon: 'person-outline',
        busy: busyArtist,
        keepOpen: true,
        run: () => goArtist(track),
      },
      ...extra.map<SheetAction>((e) => ({ label: e.label, icon: e.icon ?? (e.destructive ? 'remove-circle-outline' : 'ellipsis-horizontal-circle-outline'), run: e.run, destructive: e.destructive })),
    ];
  };

  // ---- API cho các màn hình
  const ctx = useMemo<Ctx>(
    () => ({
      openSong: (track, extra = []) => present({ kind: 'song', track, extra }),
      openActions: (header, actions) => present({ kind: 'actions', header, actions }),
      openInput: (o) =>
        present({
          kind: 'input',
          title: o.title,
          initial: o.initial ?? '',
          placeholder: o.placeholder ?? '',
          submit: o.submit ?? t('common.done'),
          onSubmit: o.onSubmit,
        }),
      toast,
    }),
    [present, toast, t]
  );

  // ---- Vuốt xuống để đóng (chạy trên UI thread)
  const onUpdate = (e: { translationY: number }) => {
    'worklet';
    y.value = e.translationY < 0 ? e.translationY * 0.15 : e.translationY;
  };
  const onDeactivate = (e: { translationY: number; velocityY: number }) => {
    'worklet';
    if (e.translationY > 90 || e.velocityY > 900) scheduleOnRN(close);
    else y.value = withSpring(0, SPRING);
  };
  const drag = usePanGesture({ activeOffsetY: 8, failOffsetX: [-20, 20], onUpdate, onDeactivate });

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, Math.max(1, cardH.value)], [1, 0], 'clamp'),
  }));

  // ---- Vẽ
  const headerOf = (c: Content): Header | null => {
    if (c.kind === 'song') return { title: c.track.title, subtitle: c.track.artist, thumb: c.track.thumb };
    if (c.kind === 'actions') return c.header;
    return null;
  };

  const renderBody = (c: Content) => {
    if (c.kind === 'song' || c.kind === 'actions') {
      const actions = c.kind === 'song' ? songActions(c.track, c.extra) : c.actions;
      return actions.map((a, i) => <ActionRow key={`${i}:${a.label}`} a={a} colors={colors} onClose={close} />);
    }
    if (c.kind === 'playlists') {
      const lists = getPlaylists();
      const track = c.track;
      const create = () =>
        setContent({
          kind: 'input',
          title: t('sheet.newPlaylist'),
          initial: '',
          placeholder: t('menu.newPlaylistHint'),
          submit: t('sheet.create'),
          onSubmit: (name) => {
            const title = name.trim() || t('home.newPlaylistName', { n: getPlaylists().length + 1 });
            const id = createPlaylist(title);
            addToPlaylist(id, track);
            toast(t('toast.added', { name: title }));
          },
        });
      return (
        <>
          <Pressable onPress={create} style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: border }]}>
            <View style={[styles.listThumb, { backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="add" size={28} color={theme.colors.onAccent} />
            </View>
            <Text style={[styles.rowLabel, { color: text }]}>{t('sheet.newPlaylist')}</Text>
          </Pressable>
          <ScrollView style={{ maxHeight: landscape ? bodyMax : winH * 0.45 }} bounces={false} showsVerticalScrollIndicator={false}>
            {lists.map((p) => {
              const has = playlistHas(p.id, track.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    close();
                    if (has) return toast(t('toast.already', { name: p.title }));
                    addToPlaylist(p.id, track);
                    toast(t('toast.added', { name: p.title }));
                  }}
                  style={({ pressed }) => [styles.listRow, pressed && { backgroundColor: border }]}
                >
                  <Thumb uri={p.thumb} icon="musical-notes" size={48} colors={colors} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '600' }}>{p.title}</Text>
                    <Text style={{ color: textSecondary, fontSize: 13, marginTop: 2 }}>{t('sheet.songsCount', { n: p.count })}</Text>
                  </View>
                  {has && <Ionicons name="checkmark-circle" size={24} color={accent} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      );
    }
    return <InputBody key={c.title} c={c} onDone={close} colors={colors} cancel={t('common.cancel')} />;
  };

  const header = content && headerOf(content);
  const titleBar = (title: string, back?: () => void) => (
    <View style={styles.titleBar}>
      {back ? (
        <Pressable onPress={back} hitSlop={12} style={{ width: 32 }}>
          <Ionicons name="chevron-back" size={24} color={text} />
        </Pressable>
      ) : (
        <View style={{ width: 32 }} />
      )}
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: text, fontSize: 17, fontWeight: '800' }}>{title}</Text>
      <View style={{ width: 32 }} />
    </View>
  );

  const sheetView = content ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 300 }]} pointerEvents={shown ? 'auto' : 'none'}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }, backdropStyle]}>
            <Pressable style={{ flex: 1 }} onPress={close} />
          </Animated.View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
            <Animated.View
              onLayout={(e) => onCardLayout(e.nativeEvent.layout.height)}
              style={[styles.card, { marginBottom: Math.max(8, insets.bottom - 26) }, landscape && { width: Math.min(winW - 32, 560), alignSelf: 'center', marginHorizontal: 0 }, cardStyle]}
            >
              {/* Kính mờ theo theme */}
              {dark ? (
                Platform.OS === 'ios' ? (
                  <>
                    <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,20,20,0.32)' }]} />
                  </>
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(22,22,22,0.86)' }]} />
                )
              ) : (
                <>
                  {Platform.OS === 'ios' && <BlurView intensity={50} tint={glassTint} style={StyleSheet.absoluteFill} />}
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'ios' ? `rgba(${glassRgb},0.72)` : surface }]} />
                </>
              )}
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.edge, { borderColor: border }]} />

              {/* Phần đầu: thanh kéo + bài / album đang thao tác. Vuốt xuống ở đây để đóng */}
              <GestureDetector gesture={drag}>
                <View collapsable={false}>
                  <View style={[styles.grab, { backgroundColor: textSecondary }]} />
                  {header ? (
                    <View style={[styles.header, { borderBottomColor: border }]}>
                      <Thumb uri={header.thumb} icon={header.icon} round={header.round} colors={colors} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: text, fontSize: 16, fontWeight: '800' }}>{header.title}</Text>
                        {!!header.subtitle && <Text numberOfLines={1} style={{ color: textSecondary, fontSize: 14, marginTop: 2 }}>{header.subtitle}</Text>}
                      </View>
                    </View>
                  ) : content.kind === 'playlists' ? (
                    titleBar(t('sheet.addPlaylist'), () => setContent({ kind: 'song', track: content.track, extra: [] }))
                  ) : content.kind === 'input' ? (
                    titleBar(content.title)
                  ) : null}
                </View>
              </GestureDetector>

              <Animated.View key={content.kind} entering={FadeIn.duration(160)} style={{ paddingVertical: 6 }}>
                {landscape && content.kind !== 'playlists' ? (
                  <ScrollView style={{ maxHeight: bodyMax }} bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {renderBody(content)}
                  </ScrollView>
                ) : (
                  renderBody(content)
                )}
              </Animated.View>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
  ) : null;

  return (
    <SheetContext.Provider value={ctx}>
      <SheetOpenContext.Provider value={!!content}>{children}</SheetOpenContext.Provider>

      {/* Thông báo nhỏ ở đáy màn hình */}
      {toastMsg && (
        <RNAnimated.View
          pointerEvents="none"
          style={[
            styles.toast,
            { bottom: insets.bottom + 96, opacity: toastA, transform: [{ translateY: toastA.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
          ]}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>{toastMsg}</Text>
        </RNAnimated.View>
      )}

      {content &&
        (dark ? (
          // Mở trong player: bảng nằm trong cửa sổ riêng (Modal) luôn ở trên cùng. Nhờ vậy hai trang sách nghiêng 3D của
          // player ngang không đè lên bảng, không phải duỗi phẳng chúng ra nữa (ảnh bìa và lời đứng yên khi mở bảng)
          <Modal visible transparent animationType="none" statusBarTranslucent supportedOrientations={ORIENTATIONS} onRequestClose={close}>
            <GestureHandlerRootView style={{ flex: 1 }}>{sheetView}</GestureHandlerRootView>
          </Modal>
        ) : (
          sheetView
        ))}
    </SheetContext.Provider>
  );
}

const styles = StyleSheet.create({
  kav: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  card: { marginHorizontal: 8, borderRadius: 34, overflow: 'hidden', paddingBottom: 10 },
  edge: { borderRadius: 34, borderWidth: StyleSheet.hairlineWidth },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, opacity: 0.5, marginTop: 8, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  titleBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, height: 56 },
  rowIcon: { width: 28, alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: 17, fontWeight: '600' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 8 },
  listThumb: { width: 48, height: 48, borderRadius: 6 },
  input: { height: 50, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, fontSize: 17, fontWeight: '600' },
  btn: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  toast: {
    position: 'absolute', alignSelf: 'center', zIndex: 400, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 22,
    backgroundColor: 'rgba(30,30,30,0.92)',
  },
});


type Colors = ReturnType<typeof useTheme>['theme']['colors'];

function ActionRow({ a, colors, onClose }: { a: SheetAction; colors: Colors; onClose: () => void }) {
  const color = a.destructive ? DANGER : colors.text;
  return (
    <Pressable
      onPress={() => {
        if (a.busy) return;
        if (!a.keepOpen) onClose();
        a.run();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.border }]}
    >
      <View style={styles.rowIcon}>
        {a.busy ? (
          <ActivityIndicator color={colors.textSecondary} />
        ) : (
          <Ionicons name={a.icon} size={26} color={a.on ? colors.accent : a.destructive ? DANGER : colors.textSecondary} />
        )}
      </View>
      <Text numberOfLines={1} style={[styles.rowLabel, { color }]}>{a.label}</Text>
    </Pressable>
  );
}

function Thumb({ uri, icon, round, size = 52, colors }: { uri?: string; icon?: IconName; round?: boolean; size?: number; colors: Colors }) {
  const box = { width: size, height: size, borderRadius: round ? size / 2 : 6, backgroundColor: colors.surface };
  return uri ? (
    <Image source={{ uri }} style={box} />
  ) : (
    <View style={[box, { alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name={icon ?? 'musical-notes'} size={size * 0.42} color={colors.textSecondary} />
    </View>
  );
}

// Ô nhập tên (playlist mới, đổi tên): nằm ngay trong tấm, bàn phím đẩy tấm lên
function InputBody({ c, onDone, colors, cancel }: { c: Extract<Content, { kind: 'input' }>; onDone: () => void; colors: Colors; cancel: string }) {
  const [v, setV] = useState(c.initial);
  const submit = () => {
    onDone();
    c.onSubmit(v);
  };
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 }}>
      <TextInput
        value={v}
        onChangeText={setV}
        autoFocus
        placeholder={c.placeholder}
        placeholderTextColor={colors.textSecondary}
        onSubmitEditing={submit}
        returnKeyType="done"
        selectionColor={colors.accent}
        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.border }]}
      />
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
        <Pressable onPress={onDone} style={[styles.btn, { backgroundColor: colors.border }]}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{cancel}</Text>
        </Pressable>
        <Pressable onPress={submit} style={[styles.btn, { backgroundColor: colors.accent }]}>
          <Text style={{ color: colors.onAccent, fontSize: 16, fontWeight: '800' }}>{c.submit}</Text>
        </Pressable>
      </View>
    </View>
  );
}
