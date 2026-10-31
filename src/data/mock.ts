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