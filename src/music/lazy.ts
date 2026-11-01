import { Platform } from 'react-native';
import type { Track } from '../data/mock';
import type { Song } from './ytmusic';

// youtubei.js và expo-audio chỉ nạp khi thật sự dùng, và không bao giờ nạp trên web
// (trên web thư viện youtubei.js làm app sập vì lỗi import vòng).
export const musicSupported = Platform.OS !== 'web';
export const ytmusic = () => require('./ytmusic') as typeof import('./ytmusic');
export const audio = () => require('./audioPlayer') as typeof import('./audioPlayer');

export function toTrack(s: Song): Track {
  return { id: s.id, title: s.title, artist: s.artist, color: '#2A2A2A', duration: s.duration ?? 0, thumb: s.thumb, album: s.album };
}
