import { ActionSheetIOS, Alert, Keyboard, Platform } from 'react-native';
import type { Track } from '../data/mock';
import { Translate } from '../i18n';
import { ExtraAction, useActionSheet } from './ActionSheet';

type Action = { label: string; run: () => void; destructive?: boolean };

// Hiện menu chọn: iOS dùng action sheet gốc của hệ thống, Android dùng hộp thoại (dùng chung cho cả app)
export function sheet(t: Translate, title: string, message: string | undefined, actions: Action[]) {
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

// Menu của một bài hát (nút ... hoặc nhấn giữ): mở bảng thao tác của app (ActionSheet).
// extra: thêm lựa chọn riêng của từng màn hình (ví dụ "Xoá khỏi playlist").
export function useSongMenu() {
  const { openSong } = useActionSheet();
  return (track: Track, extra: ExtraAction[] = []) => {
    Keyboard.dismiss();
    openSong(track, extra);
  };
}
