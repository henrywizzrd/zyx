import { ActionSheetIOS, Alert, Keyboard, Platform } from 'react-native';
import type { Track } from '../data/mock';
import { addToPlaylist, createPlaylist, getPlaylists } from '../data/db';
import { usePlayer } from '../player/PlayerProvider';
import { Translate, useT } from '../i18n';

type Action = { label: string; run: () => void; destructive?: boolean };

// Hiện menu chọn: iOS dùng action sheet gốc của hệ thống, Android dùng hộp thoại
function sheet(t: Translate, title: string, message: string | undefined, actions: Action[]) {
  if (Platform.OS === 'ios') {
    const destructive = actions.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: [...actions.map((a) => a.label), t('common.cancel')],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
      },
      (i) => actions[i]?.run()
    );
  } else {
    Alert.alert(title, message, [
      ...actions.map((a) => ({ text: a.label, onPress: a.run, style: a.destructive ? ('destructive' as const) : ('default' as const) })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }
}

function addToPlaylistMenu(t: Translate, track: Track) {
  const lists = getPlaylists().slice(0, 8);
  const createAndAdd = (name: string) => {
    const id = createPlaylist(name);
    addToPlaylist(id, track);
  };
  const defaultName = () => t('home.newPlaylistName', { n: getPlaylists().length + 1 });
  sheet(t, t('menu.addToPlaylistTitle'), track.title, [
    {
      label: t('menu.newPlaylist'),
      run: () => {
        if (Platform.OS === 'ios') {
          Alert.prompt(t('menu.newPlaylistPrompt'), t('menu.newPlaylistHint'), (name) => createAndAdd(name || defaultName()), 'plain-text', '');
        } else {
          // Android không có hộp nhập chữ sẵn: tạo tên mặc định, đổi tên sau trong trang playlist
          createAndAdd(defaultName());
        }
      },
    },
    ...lists.map((p) => ({ label: p.title, run: () => addToPlaylist(p.id, track) })),
  ]);
}

// Menu khi nhấn giữ một bài. extra: thêm lựa chọn riêng của từng màn hình (ví dụ "Xoá khỏi playlist").
export function useSongMenu() {
  const { playNext, addToQueue, liked, toggleLike } = usePlayer();
  const t = useT();
  return (track: Track, extra: Action[] = []) => {
    Keyboard.dismiss();
    const isLiked = liked.has(track.id);
    sheet(t, track.title, track.artist, [
      { label: t('menu.playNext'), run: () => playNext(track) },
      { label: t('menu.addQueue'), run: () => addToQueue(track) },
      { label: t(isLiked ? 'menu.unlike' : 'menu.like'), run: () => toggleLike(track.id, track) },
      // iOS: chờ menu đầu đóng hẳn rồi mới mở menu thứ hai
      { label: t('menu.addPlaylist'), run: () => setTimeout(() => addToPlaylistMenu(t, track), Platform.OS === 'ios' ? 350 : 0) },
      ...extra,
    ]);
  };
}
