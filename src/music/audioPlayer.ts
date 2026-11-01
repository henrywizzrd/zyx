import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';

// Một player duy nhất cho cả app, không bị huỷ khi đổi tab.
let player: AudioPlayer | null = null;

export function getPlayer(): AudioPlayer {
  if (!player) {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    player = createAudioPlayer(null);
  }
  return player;
}