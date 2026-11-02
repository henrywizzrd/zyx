import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StatusBar, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { PlayerProvider } from './src/player/PlayerProvider';
import { FloatingDock, useContentInsets } from './src/components/FloatingDock';
import { MiniPlayer } from './src/components/MiniPlayer';
import { HomeScreen } from './src/screens/HomeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { NowPlayingScreen } from './src/screens/NowPlayingScreen';
import { ActionSheetProvider } from './src/components/ActionSheet';
import { TabId } from './src/theme/types';
import { DropPreview } from './src/components/DropPreview';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { SearchScreen } from './src/screens/SearchScreen';
import * as ScreenOrientation from 'expo-screen-orientation';
import { PlayerTransition } from './src/components/PlayerTransition';
import { NavProvider, useNav } from './src/nav/Nav';
import { CollectionScreen } from './src/screens/CollectionScreen';
import { ArtistScreen } from './src/screens/ArtistScreen';
import { SwipeBack } from './src/nav/SwipeBack';
import { AppBackground } from './src/components/AppBackground';
import { AmbientEffect } from './src/components/AmbientLayer';
import { musicSupported, ytmusic } from './src/music/lazy';
import { ThemeTransition } from './src/theme/ThemeTransition';
import { ThemeStudioScreen } from './src/screens/ThemeStudioScreen';

// Các màn hình tab không nhận props: bọc memo để App vẽ lại (đổi tab, mở trang...) thì chúng không phải vẽ lại theo.
// Chúng vẫn tự cập nhật khi theme, dữ liệu, player... đổi (qua context)
const HomeTab = React.memo(HomeScreen);
const SearchTab = React.memo(SearchScreen);
const LibraryTab = React.memo(LibraryScreen);
const SettingsTab = React.memo(SettingsScreen);

ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});

function Placeholder({ name }: { name: string }) {
  const { theme } = useTheme();
  const pad = useContentInsets();
  return (
    <View style={{ flex: 1, paddingTop: pad.top + 16, paddingLeft: pad.left + 16 }}>
      <Text style={{ color: theme.colors.text, fontSize: 26, fontWeight: '700' }}>{name}</Text>
    </View>
  );
}

function Root() {
  const { theme } = useTheme();
  const [tab, setTab] = useState<TabId>('home');
  const [lastTab, setLastTab] = useState<TabId>('home');
  const nav = useNav();
  // Độ hiện của tab phía dưới các trang mở chồng (1 = hiện rõ, 0 = ẩn). SwipeBack điều khiển giá trị này.
  // Chạy bằng luồng JS chứ không phải native driver: giá trị native có thể bị React ghi đè bằng giá trị cũ
  // mỗi lần app vẽ lại (đổi theme...), làm tab trắng trơn khi quay ra
  const tabFade = useRef(new Animated.Value(1)).current;
  const depth = nav.stack.length;
  useLayoutEffect(() => {
    // Đóng hết trang (đổi tab trên dock, hoặc quay lại tới tab): tab hiện rõ ngay
    if (depth === 0) {
      tabFade.stopAnimation();
      tabFade.setValue(1);
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
  const shown = tab === 'player' ? lastTab : tab; // đang mở player thì vẫn vẽ tab phía sau
  // Tab đã mở thì giữ lại (chỉ ẩn đi), không dựng lại từ đầu mỗi lần bấm dock.
  // Trước đây mỗi lần đổi tab là dựng lại cả màn hình (Home, Thư viện...), luồng JS bận một lúc nên bấm dock tiếp bị "đơ"
  const visited = useRef(new Set<TabId>()).current;
  visited.add(shown);
  const tabLayer = (id: TabId, el: React.ReactNode) =>
    visited.has(id) ? (
      <View key={id} pointerEvents={shown === id ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { display: shown === id ? 'flex' : 'none' }]}>
        {el}
      </View>
    ) : null;

  return (
    // Bảng thao tác (nút ... của bài hát / album) nằm trên cùng, kể cả trên Player
    <ActionSheetProvider closePlayer={() => tab === 'player' && setTab(lastTab)}>
    <View style={{ flex: 1, backgroundColor: theme.background.color }}>
      <StatusBar barStyle={theme.colors.statusBar} />
      {/* Nền chung: màu của bộ màu, ảnh/GIF hoặc video người dùng chọn */}
      <AppBackground />
      {/* Hiệu ứng nền (tuyết, lá, cá, hạt cà phê): chạy liên tục sau mọi trang, chỉ dừng khi mở Player */}
      <AmbientEffect paused={tab === 'player'} />
      <View style={{ flex: 1 }}>
        {/* Tab hiện tại. Có trang mở chồng thì tab mờ dần đi theo vị trí trang (vuốt quay lại thì hiện lại dần),
            để trang trong suốt phía trên chỉ thấy nền chung, không thấy chữ của tab chồng lên */}
        <Animated.View
          pointerEvents={page ? 'none' : 'auto'}
          style={{ flex: 1, opacity: tabFade }}
        >
          {tabLayer('home', <HomeTab />)}
          {tabLayer('search', <SearchTab />)}
          {tabLayer('library', <LibraryTab />)}
          {tabLayer('settings', <SettingsTab />)}
        </Animated.View>
        {/* Trang playlist/album mở chồng lên tab, dock và mini player vẫn nằm trên */}
        {page && (
          <SwipeBack
            key={page.type === 'collection' ? `${page.source}:${page.id}:${nav.stack.length}` : page.type === 'artist' ? `artist:${page.id}:${nav.stack.length}` : `${page.type}:${nav.stack.length}`}
            onBack={nav.pop}
            fade={tabFade}
            bottom={nav.stack.length === 1}
          >
            {page.type === 'collection' ? (
              <CollectionScreen page={page} />
            ) : page.type === 'artist' ? (
              <ArtistScreen page={page} />
            ) : (
              <ThemeStudioScreen />
            )}
          </SwipeBack>
        )}
        <DropPreview />
        <MiniPlayer hidden={tab === 'player'} onOpen={() => setTab('player')} />
          <FloatingDock active={tab} onChange={go} hidden={tab === 'player'} />
          <PlayerTransition open={tab === 'player'} onClose={() => setTab(lastTab)}>
          <NowPlayingScreen onClose={() => setTab(lastTab)} />
        </PlayerTransition>
      </View>
    </View>
    </ActionSheetProvider>
  );
}

// Màn hình chờ lúc mở app: chuẩn bị sẵn mọi thứ của YouTube Music trước khi hiện giao diện.
//  - nạp thư viện youtubei.js (nặng)
//  - tạo phiên duyệt (tìm kiếm, Home...) và phiên phát nhạc (tải + phân tích player của YouTube để giải mã link)
// Nhờ vậy khi giao diện hiện ra: bấm dock không đơ, bấm bài là phát ngay.
// Player đã phân tích được lưu vào file, nên từ lần mở app thứ hai thường nhanh hơn hẳn.
// Chờ tối đa BOOT_MAX_MS (mạng chậm): quá thì vẫn vào app, phần còn lại chạy tiếp phía sau.
const BOOT_MAX_MS = 4000;
function Boot({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const [ready, setReady] = useState(!musicSupported);
  useEffect(() => {
    if (ready) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setReady(true);
    };
    const cap = setTimeout(finish, BOOT_MAX_MS);
    // Chờ một khung hình để màn hình chờ hiện ra trước, rồi mới nạp
    const id = setTimeout(() => {
      try {
        const yt = ytmusic();
        Promise.all([yt.getBrowseSession(), yt.getSession()]).catch(() => {}).finally(finish);
      } catch (e) {
        console.warn('[boot] preload', e);
        finish();
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

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PlayerProvider>
            <NavProvider>
              {/* Đổi bộ màu mượt cho cả app (chụp màn hình rồi tan dần) */}
              <Boot>
                <ThemeTransition>
                  <Root />
                </ThemeTransition>
              </Boot>
            </NavProvider>
          </PlayerProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}