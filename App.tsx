import React, { useState } from 'react';
import { StatusBar, Text, View } from 'react-native';
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.background.color }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1 }}>
        {tab === 'home' && <HomeScreen />}
        {tab === 'search' && <SearchScreen />}
        {tab === 'library' && <LibraryScreen />}
        {tab === 'settings' && <SettingsScreen />}
        {tab === 'player' && <NowPlayingScreen />}
        <DropPreview />
        <MiniPlayer hidden={tab === 'player'} onOpen={() => setTab('player')} />
        <FloatingDock active={tab} onChange={setTab} />
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <PlayerProvider>
          <Root />
        </PlayerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}