export interface Item {
  id: string;
  title: string;
  subtitle: string;
  color: string;
}

export const recentlyPlayed: Item[] = [
  { id: 'r1', title: 'Liked Songs', subtitle: 'Playlist', color: '#5B3CC4' },
  { id: 'r2', title: 'Chill Vibes', subtitle: 'Playlist', color: '#2E7D6B' },
  { id: 'r3', title: 'Lo-fi Beats', subtitle: 'Playlist', color: '#C25B3C' },
  { id: 'r4', title: 'Night Drive', subtitle: 'Playlist', color: '#3C6DC2' },
  { id: 'r5', title: 'Top Hits VN', subtitle: 'Playlist', color: '#B02A5B' },
  { id: 'r6', title: 'Focus Flow', subtitle: 'Playlist', color: '#7A8A2E' },
];

export const madeForYou: Item[] = [
  { id: 'm1', title: 'Daily Mix 1', subtitle: 'Artist A, Artist B', color: '#4C2E8A' },
  { id: 'm2', title: 'Daily Mix 2', subtitle: 'Artist C, Artist D', color: '#8A2E4C' },
  { id: 'm3', title: 'Daily Mix 3', subtitle: 'Artist E, Artist F', color: '#2E8A6E' },
  { id: 'm4', title: 'Discover Weekly', subtitle: 'New picks', color: '#8A6E2E' },
];

export const newReleases: Item[] = [
  { id: 'n1', title: 'Song One', subtitle: 'Single', color: '#2E5E8A' },
  { id: 'n2', title: 'Song Two', subtitle: 'Album', color: '#8A2E2E' },
  { id: 'n3', title: 'Song Three', subtitle: 'Single', color: '#5E8A2E' },
  { id: 'n4', title: 'Song Four', subtitle: 'EP', color: '#6E2E8A' },
];

export interface Track {
  id: string;
  title: string;
  artist: string;
  color: string;
  duration: number; // giây
  thumb?: string;
  album?: string;
}

export const tracks: Track[] = [
  { id: 't1', title: 'Midnight Drive', artist: 'Neon Atlas', color: '#5B3CC4', duration: 214 },
  { id: 't2', title: 'Slow Tides', artist: 'Harbor Lights', color: '#2E7D6B', duration: 187 },
  { id: 't3', title: 'Paper Planes', artist: 'Kite & Co', color: '#C25B3C', duration: 243 },
  { id: 't4', title: 'Afterglow', artist: 'Violet Hour', color: '#B02A5B', duration: 201 },
];

export interface LibraryItem {
  id: string;
  title: string;
  subtitle: string;
  kind: 'playlist' | 'album';
  color: string;
}

export const profile = {
  name: 'Espiso',
  tag: 'sing',
  wallColor: '#0B4A7A',
  avatarColor: '#C25B3C',
};

export const followers = [
  { id: 'f1', initial: 'T', color: '#5B3CC4' },
  { id: 'f2', initial: 'M', color: '#2E7D6B' },
  { id: 'f3', initial: 'K', color: '#B02A5B' },
  { id: 'f4', initial: 'L', color: '#7A8A2E' },
];

export const libraryItems: LibraryItem[] = [
  { id: 'l1', title: 'Liked Songs', subtitle: 'Playlist • Espiso', kind: 'playlist', color: '#5B3CC4' },
  { id: 'l2', title: 'Chill Vibes', subtitle: 'Playlist • Espiso', kind: 'playlist', color: '#2E7D6B' },
  { id: 'l3', title: 'After Hours', subtitle: 'Album • Neon Atlas', kind: 'album', color: '#B02A5B' },
  { id: 'l4', title: 'Late Night Feeling', subtitle: 'Playlist • Espiso', kind: 'playlist', color: '#3C6DC2' },
  { id: 'l5', title: 'Golden Hour', subtitle: 'Album • Harbor Lights', kind: 'album', color: '#C2A23C' },
  { id: 'l6', title: 'Road Trip', subtitle: 'Playlist • Espiso', kind: 'playlist', color: '#C25B3C' },
  { id: 'l7', title: 'Focus Flow', subtitle: 'Playlist • Espiso', kind: 'playlist', color: '#7A8A2E' },
  { id: 'l8', title: 'Midnight Tales', subtitle: 'Album • Violet Hour', kind: 'album', color: '#6E2E8A' },
  { id: 'l9', title: 'Workout Mix', subtitle: 'Playlist • Espiso', kind: 'playlist', color: '#8A2E2E' },
  { id: 'l10', title: 'Lo-fi Beats', subtitle: 'Playlist • Espiso', kind: 'playlist', color: '#2E5E8A' },
];

export const genres = [
  { id: 'g1', title: 'Pop', color: '#8D67AB' },
  { id: 'g2', title: 'Hip-Hop', color: '#BA5D07' },
  { id: 'g3', title: 'Rock', color: '#E91429' },
  { id: 'g4', title: 'Chill', color: '#477D95' },
  { id: 'g5', title: 'Lo-fi', color: '#1E3264' },
  { id: 'g6', title: 'Dance', color: '#D84000' },
  { id: 'g7', title: 'Indie', color: '#608108' },
  { id: 'g8', title: 'Jazz', color: '#7D4B32' },
  { id: 'g9', title: 'V-Pop', color: '#AF2896' },
  { id: 'g10', title: 'Focus', color: '#503750' },
];