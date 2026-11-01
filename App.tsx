import React, { useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
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
import { PlayerTransition } from './src/components/PlayerTransition';

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
  const go = (t: TabId) => {
    if (t !== 'player') setLastTab(t);
    setTab(t);
  };
  const shown = tab === 'player' ? lastTab : tab; // đang mở player thì vẫn vẽ tab phía sau

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.color }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        {shown === 'home' && <HomeScreen />}
        {shown === 'search' && <SearchScreen />}
        {shown === 'library' && <LibraryScreen />}
        {shown === 'settings' && <SettingsScreen />}
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
            <Root />
          </PlayerProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}