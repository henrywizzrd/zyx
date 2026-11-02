import React, { useLayoutEffect, useRef, useState } from 'react';
import { Animated, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { PlayerProvider } from './src/player/PlayerProvider';
import { FloatingDock, useContentInsets } from './src/components/FloatingDock';
import { MiniPlayer } from './src/components/MiniPlayer';
import { HomeScreen } from './src/screens/HomeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { NowPlayingScreen } from './src/screens/NowPlayingScreen';
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
import { ThemeTransition } from './src/theme/ThemeTransition';
import { ThemeStudioScreen } from './src/screens/ThemeStudioScreen';

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
  const { width } = useWindowDimensions();
  // Vị trí ngang của trang mở chồng (0 = đã mở hẳn, width = đã đóng): dùng chung giữa SwipeBack và lớp tab
  const pageX = useRef(new Animated.Value(width)).current;
  // 1 khi đang có từ 2 trang chồng nhau trở lên (tab bên dưới ẩn hẳn)
  const deep = useRef(new Animated.Value(0)).current;
  const depth = nav.stack.length;
  useLayoutEffect(() => {
    deep.setValue(depth > 1 ? 1 : 0);
    // Đóng hết trang (đổi tab, hoặc quay lại tới tab): đưa vị trí trang về "đã đóng" để tab hiện rõ.
    // Phải đặt lại giá trị chứ không thay opacity bằng số 1: giá trị đang chạy bằng native driver,
    // đổi sang số thường thì phía native vẫn giữ opacity 0 cũ → tab trắng trơn
    if (depth === 0) pageX.setValue(width);
  }, [depth, width, deep, pageX]);
  const tabOpacity = useRef(
    Animated.multiply(
      pageX.interpolate({ inputRange: [0, width], outputRange: [0, 1], extrapolate: 'clamp' }),
      Animated.subtract(1, deep)
    )
  ).current;
  const go = (t: TabId) => {
    if (t !== 'player') {
      setLastTab(t);
      nav.reset(); // đổi tab thì đóng các trang đang mở (playlist, album...)
    }
    setTab(t);
  };
  const page = nav.stack[nav.stack.length - 1];
  const shown = tab === 'player' ? lastTab : tab; // đang mở player thì vẫn vẽ tab phía sau

  return (
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
          style={{ flex: 1, opacity: tabOpacity }}
        >
          {shown === 'home' && <HomeScreen />}
          {shown === 'search' && <SearchScreen />}
          {shown === 'library' && <LibraryScreen />}
          {shown === 'settings' && <SettingsScreen />}
        </Animated.View>
        {/* Trang playlist/album mở chồng lên tab, dock và mini player vẫn nằm trên */}
        {page && (
          <SwipeBack
            key={page.type === 'collection' ? `${page.source}:${page.id}:${nav.stack.length}` : page.type === 'artist' ? `artist:${page.id}:${nav.stack.length}` : `${page.type}:${nav.stack.length}`}
            onBack={nav.pop}
            x={pageX}
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
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PlayerProvider>
            <NavProvider>
              {/* Đổi bộ màu mượt cho cả app (chụp màn hình rồi tan dần) */}
              <ThemeTransition>
                <Root />
              </ThemeTransition>
            </NavProvider>
          </PlayerProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}