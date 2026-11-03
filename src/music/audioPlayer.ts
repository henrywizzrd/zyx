import { createAudioPlayer, setAudioModeAsync, AudioPlayer, AudioMetadata } from 'expo-audio';

// Một player duy nhất cho cả app, không bị huỷ khi đổi tab.
let player: AudioPlayer | null = null;
let lockScreenOn = false;

export function getPlayer(): AudioPlayer {
  if (!player) {
    // shouldPlayInBackground: tắt màn hình / chuyển sang app khác vẫn phát tiếp
    // interruptionMode 'doNotMix': app nhạc chính (dừng app khác đang phát), bắt buộc để hiện điều khiển ở màn hình khoá
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {});
    player = createAudioPlayer(null);
  }
  return player;
}

// Hiện bài đang phát ở màn hình khoá / thanh thông báo (tên bài, ca sĩ, ảnh, nút phát/dừng, thanh tua).
// Trên Android đây cũng là thứ giữ cho nhạc chạy nền: không bật thì hệ điều hành dừng nhạc sau khoảng 3 phút.
// Lần đầu bật điều khiển, các bài sau chỉ đổi thông tin. Lỗi (vd. Expo Go không hỗ trợ) thì bỏ qua, nhạc vẫn phát
export function showNowPlaying(meta: AudioMetadata) {
  const p = getPlayer();
  try {
    if (!lockScreenOn) {
      p.setActiveForLockScreen(true, meta, { showSeekForward: false, showSeekBackward: false });
      lockScreenOn = true;
    } else {
      p.updateLockScreenMetadata(meta);
    }
  } catch (e) {
    console.warn('[lockscreen]', e);
  }
}
