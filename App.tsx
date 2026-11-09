import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { installAppLog, log, setLogContext } from './src/data/applog';
import { JankMonitor, useRenderProbe } from './src/components/JankMonitor';
import { updateCoverTint } from './src/theme/coverTint';
import { LogScreen } from './src/screens/LogScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { AppleDock } from './src/components/AppleDock';
import { OfflineBanner } from './src/components/OfflineBanner';
import { ActivityIndicator, Animated, Platform, StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ScreenSizeProvider } from './src/components/ScreenSize';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DOCK_THICKNESS } from './src/components/layout';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { PlayerProvider, usePlayerPick } from './src/player/PlayerProvider';
import { FloatingDock, useContentInsets } from './src/components/FloatingDock';
import { MiniPlayer } from './src/components/MiniPlayer';
import { HomeScreen } from './src/screens/HomeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { NowPlayingScreen } from './src/screens/NowPlayingScreen';
import { ActionSheetProvider } from './src/components/ActionSheet';
import { Freeze } from './src/components/Freeze';
import { GenreScreen } from './src/screens/GenreScreen';
import { TabId } from './src/theme/types';
import { DropPreview } from './src/components/DropPreview';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import * as ScreenOrientation from 'expo-screen-orientation';
import { UserScreen } from './src/screens/UserScreen';
import { FeedScreen } from './src/screens/FeedScreen';
import { ComposerHost } from './src/components/PostComposer';
import { syncSharedPlaylists } from './src/data/sharedSync';
import { startBackup } from './src/data/backup';
import { useDbVersion } from './src/data/db';
import { useSession } from './src/data/auth';
import { PlayerTransition } from './src/components/PlayerTransition';
import { BackdropBlur } from './src/components/BackdropBlur';
import { NavProvider, Page, useNav, useNavStack } from './src/nav/Nav';
import { CollectionScreen } from './src/screens/CollectionScreen';
import { ArtistScreen } from './src/screens/ArtistScreen';
import { FadeLayer, SwipeBack } from './src/nav/SwipeBack';
import RAnimated, { cancelAnimation, Easing as REasing, makeMutable, SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { AppBackground } from './src/components/AppBackground';
import { AmbientEffect } from './src/components/AmbientLayer';
import { musicSupported, ytmusic } from './src/music/lazy';
import { ThemeTransition } from './src/theme/ThemeTransition';
import { ThemeStudioScreen } from './src/screens/ThemeStudioScreen';
import { AppUpdater } from './src/components/AppUpdater';
import { AuthGate } from './src/screens/AuthGate';

// Các màn hình tab không nhận props: bọc memo để App vẽ lại (đổi tab, mở trang...) thì chúng không phải vẽ lại theo.
// Chúng vẫn tự cập nhật khi theme, dữ liệu, player... đổi (qua context)
const HomeTab = React.memo(HomeScreen);
const SearchTab = React.memo(SearchScreen);
const LibraryTab = React.memo(LibraryScreen);
const SettingsTab = React.memo(SettingsScreen);

// Xoay theo điện thoại: dọc, ngang trái, ngang phải (không lộn ngược)
ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {});

function Placeholder({ name }: { name: string }) {
  const { theme } = useTheme();
  const pad = useContentInsets();
  return (
    <View style={{ flex: 1, paddingTop: pad.top + 16, paddingLeft: pad.left + 16 }}>
      <Text style={{ color: theme.colors.text, fontSize: 26, fontWeight: '700' }}>{name}</Text>
    </View>
  );
}

// Khoá cố định cho mỗi trang trong chồng (theo vị trí + nội dung), để mở thêm trang không làm trang cũ bị dựng lại
function pageKey(pg: Page, i: number) {
  if (pg.type === 'collection') return `${i}:col:${pg.source}:${pg.id}`;
  if (pg.type === 'artist') return `${i}:artist:${pg.id}`;
  if (pg.type === 'genre') return `${i}:genre:${pg.params}`;
  if (pg.type === 'user') return `${i}:user:${pg.id}`;
  return `${i}:${pg.type}`;
}

// ---- Chuyển tab trên dock: trượt nhẹ + mờ (kiểu Android 14 / Material "shared axis")
// 4 tab coi như nằm thành hàng ngang: Home, Search, Library, Settings.
//  - sang tab bên phải: tab cũ trượt sang trái ~30px và mờ đi, tab mới từ bên phải 30px trượt vào và hiện dần (và ngược lại)
//  - nhảy xa (Home → Settings): đi thẳng, chỉ thấy 2 tab, các tab ở giữa vẫn đóng băng
//  - bấm liên tục: mỗi tab có độ mờ / vị trí riêng, mỗi lần bấm là chạy tiếp từ đúng chỗ đang dở (không giật, không chạy lại từ đầu)
// Tất cả chạy trên UI thread. Tab ẩn hẳn (mờ xong) thì đóng băng lại như trước.
type PageTab = Exclude<TabId, 'player'>;
const TAB_ORDER: PageTab[] = ['home', 'search', 'library', 'settings'];
const TAB_SHIFT = 30;
const TAB_IN = { duration: 280, easing: REasing.out(REasing.cubic) };
const TAB_OUT = { duration: 200, easing: REasing.out(REasing.quad) };

function TabPane({ o, x, visible, active, children }: { o: SharedValue<number>; x: SharedValue<number>; visible: boolean; active: boolean; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateX: x.value }] }));
  return (
    <RAnimated.View pointerEvents={active ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { display: visible ? 'flex' : 'none' }, style]}>
      {/* Tab đang ẩn: đóng băng, không vẽ lại cho tới khi quay lại tab đó */}
      <Freeze freeze={!visible}>{children}</Freeze>
    </RAnimated.View>
  );
}

function TabStage({ shown, render }: { shown: PageTab; render: (id: PageTab) => React.ReactNode }) {
  const sv = {
    home: { o: useSharedValue(shown === 'home' ? 1 : 0), x: useSharedValue(0) },
    search: { o: useSharedValue(shown === 'search' ? 1 : 0), x: useSharedValue(0) },
    library: { o: useSharedValue(shown === 'library' ? 1 : 0), x: useSharedValue(0) },
    settings: { o: useSharedValue(shown === 'settings' ? 1 : 0), x: useSharedValue(0) },
  };
  // Các tab đang hiện trên màn hình (tab đích + các tab đang mờ dần)
  const [visible, setVisible] = useState<Set<PageTab>>(() => new Set([shown]));
  const shownRef = useRef(shown);
  const prev = useRef(shown);
  const hide = useCallback((id: PageTab) => {
    if (id === shownRef.current) return;
    setVisible((v) => {
      if (!v.has(id)) return v;
      const n = new Set(v);
      n.delete(id);
      return n;
    });
  }, []);

  useLayoutEffect(() => {
    shownRef.current = shown;
    const from = prev.current;
    prev.current = shown;
    if (from === shown) return;
    const dir = Math.sign(TAB_ORDER.indexOf(shown) - TAB_ORDER.indexOf(from)) || 1;
    // Tab mới: đang ẩn hẳn thì đặt ở bên phía nó đi vào; đang mờ dở thì chạy tiếp từ chỗ đó
    const t = sv[shown];
    if (t.o.value < 0.01) t.x.value = dir * TAB_SHIFT;
    t.o.value = withTiming(1, TAB_IN);
    t.x.value = withTiming(0, TAB_IN);
    // Mọi tab khác đang hiện: trượt ra phía ngược lại và mờ đi, mờ xong thì ẩn + đóng băng
    for (const id of TAB_ORDER) {
      if (id === shown) continue;
      const s = sv[id];
      if (s.o.value < 0.01) continue;
      s.x.value = withTiming(-dir * TAB_SHIFT, TAB_OUT);
      s.o.value = withTiming(0, TAB_OUT, (done) => {
        if (done) scheduleOnRN(hide, id);
      });
    }
    setVisible((v) => {
      const n = new Set(v);
      n.add(shown);
      return n;
    });
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {TAB_ORDER.map((id) => {
        const el = render(id);
        if (!el) return null;
        return (
          <TabPane key={id} o={sv[id].o} x={sv[id].x} visible={visible.has(id)} active={id === shown}>
            {el}
          </TabPane>
        );
      })}
    </>
  );
}

// Bộ màu "Theo ảnh bìa": mỗi lần đổi bài thì lấy màu từ ảnh bìa mới
function CoverTintSync() {
  const { theme } = useTheme();
  const { track } = usePlayerPick('track');
  const on = theme.preset === 'cover';
  useEffect(() => {
    if (on && track.id !== 'none') updateCoverTint(track.thumb);
  }, [on, track.id, track.thumb]);
  return null;
}

function Root() {
  const { theme, landscape } = useTheme();
  const [tab, setTab] = useState<TabId>('home');
  const [lastTab, setLastTab] = useState<TabId>('home');
  // Player đang hiện (kể cả lúc đang thu nhỏ về bong bóng)
  const [playerUp, setPlayerUp] = useState(false);
  useEffect(() => {
    if (tab === 'player') setPlayerUp(true);
    else setAmbientOff(false); // bắt đầu đóng player: hiệu ứng nền chạy lại ngay, trong lúc nền rõ dần
  }, [tab]);
  // Hiệu ứng nền chỉ dừng khi player đã phóng to xong hẳn (đang phóng to vẫn chạy, chỉ bị mờ đi)
  const [ambientOff, setAmbientOff] = useState(false);
  const navActions = useNav();
  const stack = useNavStack();
  const nav = { ...navActions, stack };
  // Độ hiện của tab phía dưới các trang mở chồng (1 = hiện rõ, 0 = ẩn). SwipeBack điều khiển giá trị này trên UI thread
  const tabFade = useSharedValue(1);
  const depth = nav.stack.length;
  // Độ hiện của từng trang trong chồng (trang phía trên điều khiển độ hiện của trang ngay dưới nó)
  const pageFades = useRef(new Map<string, SharedValue<number>>()).current;
  const fadeOf = (k: string) => {
    let v = pageFades.get(k);
    if (!v) {
      v = makeMutable(1);
      pageFades.set(k, v);
    }
    return v;
  };
  // Trang đã đóng thì bỏ giá trị của nó (mở lại sẽ hiện đầy đủ từ đầu)
  useEffect(() => {
    const alive = new Set(nav.stack.map((pg, i) => pageKey(pg, i)));
    for (const k of [...pageFades.keys()]) if (!alive.has(k)) pageFades.delete(k);
  }, [nav.stack, pageFades]);
  useLayoutEffect(() => {
    // Đóng hết trang (đổi tab trên dock, hoặc quay lại tới tab): tab hiện rõ ngay
    if (depth === 0) {
      cancelAnimation(tabFade);
      tabFade.value = 1;
    }
  }, [depth, tabFade]);
  const go = (t: TabId) => {
    if (t !== 'player') {
      setLastTab(t);
      nav.reset(); // đổi tab thì đóng các trang đang mở (playlist, album...)
    }
    setTab(t);
  };
  const page = nav.stack[nav.stack.length - 1];
  // Ghi vào nhật ký đang ở tab / trang nào (để biết chỗ khựng, chỗ lỗi)
  useEffect(() => {
    setLogContext(tab === 'player' ? 'player' : page ? `${tab} › ${page.type}${'title' in page ? ` "${page.title}"` : 'name' in page ? ` "${page.name}"` : ''}` : tab);
  }, [tab, page]);
  const shown = tab === 'player' ? lastTab : tab; // đang mở player thì vẫn vẽ tab phía sau
  useRenderProbe('khung app', { tab, lastTab, playerUp, ambientOff, stack: nav.stack, theme, landscape });
  // Tab đã mở thì giữ lại (chỉ ẩn đi), không dựng lại từ đầu mỗi lần bấm dock.
  // Trước đây mỗi lần đổi tab là dựng lại cả màn hình (Home, Thư viện...), luồng JS bận một lúc nên bấm dock tiếp bị "đơ"
  const visited = useRef(new Set<TabId>()).current;
  visited.add(shown);
  const tabEl = (id: PageTab) =>
    !visited.has(id) ? null : id === 'home' ? <HomeTab /> : id === 'search' ? <SearchTab /> : id === 'library' ? <LibraryTab /> : <SettingsTab />;

  return (
    // Bảng thao tác (nút ... của bài hát / album) nằm trên cùng, kể cả trên Player
    <ActionSheetProvider closePlayer={() => tab === 'player' && setTab(lastTab)}>
    <View style={{ flex: 1, backgroundColor: theme.background.color }}>
      <StatusBar barStyle={theme.colors.statusBar} />
      {/* Nền chung: màu của bộ màu, ảnh/GIF hoặc video người dùng chọn */}
      <AppBackground />
      {/* Hiệu ứng nền (tuyết, lá, cá, hạt cà phê): chạy liên tục sau mọi trang, chỉ dừng khi mở Player */}
      <AmbientEffect paused={ambientOff} />
      {Platform.OS !== 'web' && <JankMonitor />}
      <CoverTintSync />
      <View style={{ flex: 1 }}>
        <ContentArea>
        {/* Tab hiện tại. Có trang mở chồng thì tab mờ dần đi theo vị trí trang (vuốt quay lại thì hiện lại dần),
            để trang trong suốt phía trên chỉ thấy nền chung, không thấy chữ của tab chồng lên */}
        <FadeLayer value={tabFade} pointerEvents={page ? 'none' : 'auto'} style={{ flex: 1 }}>
          <TabStage shown={shown as PageTab} render={tabEl} />
        </FadeLayer>
        {/* Các trang mở chồng lên tab (playlist, album, nghệ sĩ, thể loại...). Dock và mini player vẫn nằm trên.
            Mọi trang trong chồng đều được giữ lại (không dựng lại khi quay về), nhưng chỉ trang trên cùng hiện rõ:
            trang bên dưới mờ hẳn đi, và hiện lại dần theo ngón tay khi vuốt trang trên cùng để quay lại.
            (Trước đây chỉ vẽ trang trên cùng: vuốt quay lại thì phía dưới trống trơn, thả tay ra trang cũ mới dựng lại → giật) */}
        {nav.stack.map((pg, i) => {
          const k = pageKey(pg, i);
          const top = i === nav.stack.length - 1;
          return (
            <FadeLayer key={k} value={fadeOf(k)} pointerEvents={top ? 'box-none' : 'none'} style={StyleSheet.absoluteFill}>
              {/* Trang nằm sâu hơn trang ngay dưới trang trên cùng thì không nhìn thấy được: đóng băng */}
              <Freeze freeze={i < nav.stack.length - 2}>
              <SwipeBack onBack={nav.pop} fade={i === 0 ? tabFade : fadeOf(pageKey(nav.stack[i - 1], i - 1))}>
                {pg.type === 'collection' ? (
                  <CollectionScreen page={pg} />
                ) : pg.type === 'artist' ? (
                  <ArtistScreen page={pg} />
                ) : pg.type === 'genre' ? (
                  <GenreScreen page={pg} />
                ) : pg.type === 'user' ? (
                  <UserScreen page={pg} />
                ) : pg.type === 'feed' ? (
                  <FeedScreen />
                ) : pg.type === 'log' ? (
                  <LogScreen />
                ) : pg.type === 'stats' ? (
                  <StatsScreen />
                ) : (
                  <ThemeStudioScreen />
                )}
              </SwipeBack>
              </Freeze>
            </FadeLayer>
          );
        })}
        </ContentArea>
        <DropPreview />
        <ComposerHost />
        <SharedSyncer />
        {/* Bong bóng ẩn từ lúc bấm mở player tới khi player thu hẳn về (playerUp), để không thấy hai ảnh cùng lúc */}
        {/* Bấm mở player: nền phía sau (tab + hiệu ứng) mờ dần theo độ mở; đóng thì từ mờ trở lại rõ dần */}
        {/* Luôn nằm sẵn (trong suốt khi player đóng): không phải dựng / gỡ lớp kính mờ mỗi lần mở, đóng player */}
        <BackdropBlur />
        <OfflineBanner />
        {/* Dock Apple Music có mini player riêng (viên thuốc) → không dựng bong bóng mini player */}
        {!(theme.dock.mode === 'apple' && !landscape) && <MiniPlayer hidden={tab === 'player' || playerUp} onOpen={() => setTab('player')} />}
          {/* Dock: kiểu Apple Music hoặc dạng thanh (kéo đổi chỗ được) — Cài đặt → Kiểu dock */}
          {theme.dock.mode === 'apple' && !landscape ? (
            <AppleDock active={tab} onChange={go} onOpenPlayer={() => setTab('player')} hidden={tab === 'player' || playerUp} />
          ) : (
            <FloatingDock active={tab} onChange={go} hidden={tab === 'player'} />
          )}
          <PlayerTransition open={tab === 'player'} onReopen={() => setTab('player')} onClose={() => setTab(lastTab)} onClosed={() => setPlayerUp(false)} onOpened={() => setAmbientOff(true)}>
          <NowPlayingScreen onClose={() => setTab(lastTab)} />
        </PlayerTransition>
      </View>
    </View>
    </ActionSheetProvider>
  );
}

// Vùng nội dung (tab + các trang mở chồng). Màn hình ngang: chừa tai thỏ bên trái và chỗ của dock dọc bên phải,
// rồi đo lại kích thước vùng còn lại (ScreenSizeProvider lồng bên trong) → mọi màn hình bên trong tự xếp theo đúng bề rộng
// còn lại, nội dung nằm giữa, không bị dock che
function ContentArea({ children }: { children: React.ReactNode }) {
  const { theme, landscape } = useTheme();
  const insets = useSafeAreaInsets();
  const side = landscape;
  const padL = landscape ? insets.left : 0;
  const padR = landscape ? insets.right + (side ? DOCK_THICKNESS + theme.dock.style.margin * 2 : 0) : 0;
  return (
    <View style={{ flex: 1, paddingLeft: padL, paddingRight: padR }}>
      <ScreenSizeProvider>{children}</ScreenSizeProvider>
    </View>
  );
}

// Playlist công khai: dữ liệu trong máy đổi (thêm bài, đổi tên, bật Công khai...) → vài giây sau đồng bộ lên server.
// Tách thành thành phần riêng để mỗi lần dữ liệu đổi chỉ chỗ này chạy lại, không vẽ lại cả app
function SharedSyncer() {
  const dbv = useDbVersion();
  const session = useSession();
  const acc = session?.mode === 'account' ? session.id : undefined;
  // Sao lưu / khôi phục thư viện theo tài khoản (src/data/backup.ts)
  useEffect(() => {
    startBackup(acc ?? null);
  }, [acc]);
  useEffect(() => {
    if (!acc) return;
    const id = setTimeout(syncSharedPlaylists, 2500);
    return () => clearTimeout(id);
  }, [dbv, acc]);
  return null;
}

// Màn hình chờ lúc mở app: chuẩn bị sẵn mọi thứ của YouTube Music trước khi hiện giao diện.
//  - nạp thư viện youtubei.js (nặng)
//  - tạo phiên duyệt (tìm kiếm, Home...) và phiên phát nhạc (tải + phân tích player của YouTube để giải mã link)
// Nhờ vậy khi giao diện hiện ra: bấm dock không đơ, bấm bài là phát ngay.
// Player đã phân tích được lưu vào file, nên từ lần mở app thứ hai thường nhanh hơn hẳn.
// Chờ tối đa BOOT_MAX_MS (mạng chậm): quá thì vẫn vào app, phần còn lại chạy tiếp phía sau.
// Mở app nhanh hơn: chỉ chờ phần CẦN để hiện Home (thư viện youtubei.js + phiên duyệt), tối đa BOOT_MAX_MS.
// Phiên phát nhạc (tải + phân tích player của YouTube, nặng nhất) chạy SAU khi giao diện đã hiện và đứng yên một chút,
// nên màn chờ ngắn hơn hẳn; bấm bài sớm quá thì phiên phát tự được tạo lúc đó như bình thường.
// Thời gian từng phần được ghi vào Nhật ký ("khởi động: ...") để biết phần nào chậm.
const BOOT_MAX_MS = 2500;
function Boot({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const [ready, setReady] = useState(!musicSupported);
  useEffect(() => {
    if (ready) return;
    let done = false;
    const t0 = Date.now();
    const parts: string[] = [];
    const finish = (why: string) => {
      if (done) return;
      done = true;
      setReady(true);
      const shownAt = Date.now() - t0;
      // phiên phát nhạc: đợi giao diện vẽ xong và đứng yên rồi mới tạo
      setTimeout(() => {
        const idle: (cb: () => void) => void = (globalThis as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 0));
        idle(() => {
          const s0 = Date.now();
          try {
            ytmusic()
              .getSession()
              .catch(() => {})
              .finally(() => log('ui', `khởi động: ${parts.join(', ')}; vào app sau ${shownAt}ms (${why}); phiên phát nhạc ${Date.now() - s0}ms (chạy nền sau khi vào app)`));
          } catch {}
        });
      }, 1200);
    };
    const cap = setTimeout(() => finish('hết giờ chờ'), BOOT_MAX_MS);
    // Chờ một khung hình để màn hình chờ hiện ra trước, rồi mới nạp
    const id = setTimeout(() => {
      try {
        const r0 = Date.now();
        const yt = ytmusic();
        parts.push(`nạp youtubei ${Date.now() - r0}ms`);
        const b0 = Date.now();
        yt.getBrowseSession()
          .then(() => parts.push(`phiên duyệt ${Date.now() - b0}ms`))
          .catch(() => parts.push('phiên duyệt lỗi'))
          .finally(() => finish('đủ để hiện Home'));
      } catch (e) {
        console.warn('[boot] preload', e);
        finish('lỗi nạp');
      }
    }, 16);
    return () => {
      clearTimeout(id);
      clearTimeout(cap);
    };
  }, [ready]);
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background.color, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: theme.colors.text, fontSize: 44, fontWeight: '900', letterSpacing: 6 }}>ZYX</Text>
        <ActivityIndicator color={theme.colors.textSecondary} style={{ marginTop: 18 }} />
      </View>
    );
  }
  return <>{children}</>;
}

// Nhật ký dò lỗi: bật sớm nhất có thể để bắt cả lỗi lúc khởi động
installAppLog();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ScreenSizeProvider>
        <ThemeProvider>
          <PlayerProvider>
            <NavProvider>
              {/* Đổi bộ màu mượt cho cả app (chụp màn hình rồi tan dần) */}
              <Boot>
                {/* Tự kiểm tra và tải bản cập nhật (không cần cài lại app) */}
                <AppUpdater />
                {/* Chưa đăng nhập: màn đăng nhập (Khách / Tài khoản ZYX / Google) */}
                <AuthGate>
                  <ThemeTransition>
                    <Root />
                  </ThemeTransition>
                </AuthGate>
              </Boot>
            </NavProvider>
          </PlayerProvider>
        </ThemeProvider>
        </ScreenSizeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}