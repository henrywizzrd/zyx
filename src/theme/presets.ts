// Các bộ màu có sẵn. Mọi màn hình (trừ Player) lấy màu từ đây qua theme.colors.
// Thêm bộ màu mới: thêm id vào ThemePresetId, thêm một mục vào PRESETS và tên vào PRESET_ORDER.

export type ThemePresetId = 'dark' | 'light' | 'green' | 'ocean' | 'latte' | 'snow';

// Các bộ có hiệu ứng nền chạy liên tục (bật/tắt bằng công tắc Hiệu ứng nền, nhớ riêng từng bộ)
export type AmbientPresetId = 'snow' | 'green' | 'ocean' | 'latte';
// Bộ đã có hiệu ứng nền (Latte: hạt cà phê trang trí, làm ở đợt sau)
export const AMBIENT_PRESETS: AmbientPresetId[] = ['snow', 'green', 'ocean'];

export interface Palette {
  bg: string; // nền của app
  surface: string; // thẻ, ô, nút phụ (đặc)
  card: string; // thẻ trong danh sách khi nền là ảnh/video (trong suốt một phần)
  text: string;
  textSecondary: string;
  accent: string; // màu nhấn: nút phát, mục đang chọn...
  onAccent: string; // chữ / icon đặt trên màu nhấn
  border: string;
  skeleton: string; // khung chờ khi đang tải
  glass: string; // lớp màu phủ trên kính mờ (dock, mini player, popup), dùng khi cần một màu cố định
  glassRgb: string; // màu gốc của lớp phủ kính ("r,g,b"), độ đậm tính theo thanh Độ mờ kính
  glassTint: 'dark' | 'light'; // tông của kính mờ
  statusBar: 'light-content' | 'dark-content';
  switchOff: string; // nền công tắc khi tắt
}

export const PRESETS: Record<ThemePresetId, Palette> = {
  dark: {
    bg: '#000000',
    surface: '#181818',
    card: 'rgba(24,24,24,0.55)',
    text: '#FFFFFF',
    textSecondary: '#B3B3B3',
    accent: '#1DB954',
    onAccent: '#000000',
    border: 'rgba(255,255,255,0.12)',
    skeleton: 'rgba(255,255,255,0.08)',
    glass: 'rgba(30,30,30,0.55)',
    glassRgb: '30,30,30',
    glassTint: 'dark',
    statusBar: 'light-content',
    switchOff: '#3A3A3A',
  },
  light: {
    bg: '#F7F7F7',
    surface: '#FFFFFF',
    card: 'rgba(255,255,255,0.6)',
    text: '#121212',
    textSecondary: '#5E5E5E',
    accent: '#1AA34A',
    onAccent: '#FFFFFF',
    border: 'rgba(0,0,0,0.1)',
    skeleton: 'rgba(0,0,0,0.07)',
    glass: 'rgba(255,255,255,0.6)',
    glassRgb: '255,255,255',
    glassTint: 'light',
    statusBar: 'dark-content',
    switchOff: '#D0D0D0',
  },
  green: {
    bg: '#E8F5E9',
    surface: '#D4EDD6',
    card: 'rgba(212,237,214,0.6)',
    text: '#14532D',
    textSecondary: '#3F7A52',
    accent: '#15803D',
    onAccent: '#FFFFFF',
    border: 'rgba(20,83,45,0.15)',
    skeleton: 'rgba(20,83,45,0.08)',
    glass: 'rgba(212,237,214,0.6)',
    glassRgb: '212,237,214',
    glassTint: 'light',
    statusBar: 'dark-content',
    switchOff: '#B9D9BC',
  },
  ocean: {
    bg: '#E8F1FB',
    surface: '#D3E4F7',
    card: 'rgba(211,228,247,0.6)',
    text: '#0C3B6E',
    textSecondary: '#3D6A99',
    accent: '#1D6FD1',
    onAccent: '#FFFFFF',
    border: 'rgba(12,59,110,0.15)',
    skeleton: 'rgba(12,59,110,0.08)',
    glass: 'rgba(211,228,247,0.6)',
    glassRgb: '211,228,247',
    glassTint: 'light',
    statusBar: 'dark-content',
    switchOff: '#B5CDEA',
  },
  latte: {
    bg: '#F3EBDD',
    surface: '#E8DCC6',
    card: 'rgba(232,220,198,0.6)',
    text: '#4A3426',
    textSecondary: '#7A5E4A',
    accent: '#A0673A',
    onAccent: '#FFFFFF',
    border: 'rgba(74,52,38,0.15)',
    skeleton: 'rgba(74,52,38,0.08)',
    glass: 'rgba(232,220,198,0.6)',
    glassRgb: '232,220,198',
    glassTint: 'light',
    statusBar: 'dark-content',
    switchOff: '#D6C6AA',
  },
  snow: {
    bg: '#F4F8FC',
    surface: '#FFFFFF',
    card: 'rgba(255,255,255,0.65)',
    text: '#0F2A44',
    textSecondary: '#5A7189',
    accent: '#3B82C4',
    onAccent: '#FFFFFF',
    border: 'rgba(15,42,68,0.12)',
    skeleton: 'rgba(15,42,68,0.07)',
    glass: 'rgba(255,255,255,0.6)',
    glassRgb: '255,255,255',
    glassTint: 'light',
    statusBar: 'dark-content',
    switchOff: '#C9D6E3',
  },
};

export const PRESET_ORDER: ThemePresetId[] = ['dark', 'light', 'green', 'ocean', 'latte', 'snow'];
