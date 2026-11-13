export type Position =
  | 'bottom' | 'top' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type DockPosition = Position;

// Mini player nằm tự do dọc viền màn hình: cạnh nào + vị trí dọc theo cạnh đó (0 = đầu cạnh, 1 = cuối cạnh)
export type Edge = 'top' | 'bottom' | 'left' | 'right';
export interface MiniAnchor { edge: Edge; t: number }

export type TabId = 'home' | 'search' | 'library' | 'settings' | 'player';
// Các khối của Home (thứ tự trong home.sections = thứ tự hiển thị)
export type HomeSection = 'myPlaylists' | 'recent' | 'feed' | 'trending' | 'recommended' | 'playlistPicks';
export type TrendingRange = 'week' | 'month' | 'year';
export type TrendingRegion = 'ZZ' | 'VN' | 'KR' | 'US'; // ZZ = toàn cầu (mã YouTube Music)
export type LibraryLayout = 'list' | 'columns' | 'covers2' | 'covers3';
// Dock dạng thanh hoặc kiểu Apple Music (dạng bubble góc dưới đã bỏ)
export type DockMode = 'bar' | 'apple' | 'zyx'; // zyx: thanh tab bo góc vuông + bong bóng mini player cố định + thanh Search nhỏ phía trên
export type _DockModeNote = never; // apple: kiểu Apple Music (thanh tab + nút tìm kiếm tròn + mini player viên thuốc)
export type Side = 'left' | 'right';
// Kiểu hiện lời bài hát: phát sáng (Apple Music), karaoke (tô dần theo nhạc), nảy chữ
export type LyricLook = 'glow' | 'karaoke' | 'bounce';
// Kiểu màn player: classic = ảnh bìa lớn (kiểu Spotify / Apple Music) · vinyl = đĩa than một góc (VinylPlayer)
export type PlayerLook = 'classic' | 'vinyl';

import type { Language } from '../i18n/strings';
import type { AmbientPresetId, Palette, ThemePresetId } from './presets';

// Nền của app: theo bộ màu, ảnh (cả GIF) hoặc video người dùng chọn
export type BackgroundType = 'preset' | 'image' | 'video';

export interface Theme {
  version: number;
  name: string;
  language: Language; // ngôn ngữ giao diện
  preset: ThemePresetId; // bộ màu đang dùng
  followSystem: boolean; // true: tự theo sáng/tối của điện thoại (Light ↔ Dark), preset được tính lại theo điện thoại
  // color: màu nền của bộ màu (tính tự động). uri: file ảnh/video ('' = chưa có). dim: độ tối phủ lên ảnh/video cho dễ đọc chữ (0..0.8)
  background: { type: BackgroundType; color: string; uri: string; dim: number };
  colors: Palette; // tính tự động từ preset, không tự sửa
  glass: { blur: number; material?: 'clear' | 'frost' | 'smoke' | 'matte' }; // độ mờ kính (0..100) + loại kính: Trong / Mờ / Khói / Mờ tối
  // Hiệu ứng nền của từng bộ: tuyết rơi (Snow), lá rơi (Green), bong bóng + cá (Ocean), hạt cà phê (Latte)
  // meteorLevel: mật độ sao băng của bộ Mưa sao băng (0 = ít, 1 = vừa, 2 = nhiều, 3 = bão sao băng)
  effects: { ambient: Record<AmbientPresetId, boolean>; meteorLevel?: number };
  dock: {
    position: Position;
    items: TabId[];
    labels: boolean; // hiện chữ dưới icon (Trang chủ, Tìm kiếm...)
    rimLight?: boolean; // ánh sáng ở viền trên / dưới của tấm kính dock (mặc định bật)
    mode: DockMode;
    style: { background: string; radius: number; margin: number };
  };
  miniPlayer: {
    anchor: MiniAnchor;
    collapsed: boolean; // đang thu nhỏ thành bubble (chỉ còn ảnh album)
    merged: boolean;
    style: { background: string; rectRadius: number };
  };
  library: { layout: LibraryLayout; order: string[] };
  player: { lyricLook: LyricLook; look?: PlayerLook };
  home: { sections: HomeSection[]; hidden: HomeSection[]; trendingRange: TrendingRange; trendingRegion: TrendingRegion };
}