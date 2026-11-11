// Các bộ màu có sẵn. Mọi màn hình (trừ Player) lấy màu từ đây qua theme.colors.
// Thêm bộ màu mới: thêm id vào ThemePresetId, thêm một mục vào PRESETS và tên vào PRESET_ORDER.

export type ThemePresetId = 'dark' | 'light' | 'green' | 'ocean' | 'latte' | 'snow' | 'sakura' | 'meteor' | 'starry' | 'aurora' | 'rain' | 'neon' | 'cover';

// Các bộ có hiệu ứng nền chạy liên tục (bật/tắt bằng công tắc Hiệu ứng nền, nhớ riêng từng bộ)
export type AmbientPresetId = 'snow' | 'green' | 'ocean' | 'latte' | 'sakura' | 'meteor' | 'starry' | 'aurora' | 'rain' | 'neon';
export const AMBIENT_PRESETS: AmbientPresetId[] = ['snow', 'green', 'ocean', 'latte', 'sakura', 'meteor', 'starry', 'aurora', 'rain', 'neon'];

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
  // Hoa anh đào: hồng phấn, chữ màu mận đậm
  sakura: {
    bg: '#FCEFF3',
    surface: '#F8DCE5',
    card: 'rgba(252,236,241,0.72)',
    text: '#5A2A3C',
    textSecondary: '#93607A',
    accent: '#D9547D',
    onAccent: '#FFFFFF',
    border: 'rgba(90,42,60,0.14)',
    skeleton: 'rgba(90,42,60,0.08)',
    glass: 'rgba(252,228,236,0.62)',
    glassRgb: '252,228,236',
    glassTint: 'light',
    statusBar: 'dark-content',
    switchOff: '#EBC4D1',
  },
  // Mưa sao băng: trời đêm xanh đen, nhấn màu xanh tím nhạt như ánh sao
  meteor: {
    bg: '#070B1A',
    surface: '#141B36',
    card: 'rgba(20,27,54,0.62)',
    text: '#EEF1FF',
    textSecondary: '#9CA7CC',
    accent: '#9DB4FF',
    onAccent: '#0A0F24',
    border: 'rgba(200,210,255,0.14)',
    skeleton: 'rgba(200,210,255,0.08)',
    glass: 'rgba(16,22,46,0.58)',
    glassRgb: '16,22,46',
    glassTint: 'dark',
    statusBar: 'light-content',
    switchOff: '#2A3458',
  },
  // Trời sao (kiểu thiên văn): trời chàm có tinh vân tím, nhấn xanh lavender như ánh sao
  starry: {
    bg: '#0B0F2E',
    surface: '#161B45',
    card: 'rgba(22,27,69,0.6)',
    text: '#EEF0FF',
    textSecondary: '#A3A9D6',
    accent: '#AFC0FF',
    onAccent: '#0B0F2E',
    border: 'rgba(175,192,255,0.14)',
    skeleton: 'rgba(175,192,255,0.08)',
    glass: 'rgba(18,22,60,0.55)',
    glassRgb: '18,22,60',
    glassTint: 'dark',
    statusBar: 'light-content',
    switchOff: '#2A3060',
  },
  // Cực quang: trời đêm xanh đen, nhấn xanh lá ngọc như dải cực quang
  aurora: {
    bg: '#04101A',
    surface: '#0D1D2A',
    card: 'rgba(13,29,42,0.62)',
    text: '#E8FBF3',
    textSecondary: '#8DB3A8',
    accent: '#5CF2B0',
    onAccent: '#03140D',
    border: 'rgba(160,255,220,0.14)',
    skeleton: 'rgba(160,255,220,0.08)',
    glass: 'rgba(10,26,36,0.58)',
    glassRgb: '10,26,36',
    glassTint: 'dark',
    statusBar: 'light-content',
    switchOff: '#1E3A44',
  },
  // Mưa trên kính: xám lạnh, nhấn xanh nước mưa
  rain: {
    bg: '#2B3036',
    surface: '#383F47',
    card: 'rgba(56,63,71,0.6)',
    text: '#EEF2F5',
    textSecondary: '#A6B0BA',
    accent: '#9CCBEA',
    onAccent: '#0F1A22',
    border: 'rgba(220,235,245,0.14)',
    skeleton: 'rgba(220,235,245,0.08)',
    glass: 'rgba(44,50,57,0.55)',
    glassRgb: '44,50,57',
    glassTint: 'dark',
    statusBar: 'light-content',
    switchOff: '#4A535D',
  },
  // Neon / Cyberpunk: tím đen, nhấn hồng neon, viền xanh cyan
  neon: {
    bg: '#0A0514',
    surface: '#1A0F2E',
    card: 'rgba(26,15,46,0.62)',
    text: '#F6EEFF',
    textSecondary: '#A99BCB',
    accent: '#FF3DCB',
    onAccent: '#16001A',
    border: 'rgba(0,240,255,0.3)',
    skeleton: 'rgba(0,240,255,0.08)',
    glass: 'rgba(22,10,40,0.6)',
    glassRgb: '22,10,40',
    glassTint: 'dark',
    statusBar: 'light-content',
    switchOff: '#33204F',
  },
  // Theo màu ảnh bìa: bảng màu gốc (tối); khi đang nghe nhạc, nền + màu nhấn lấy từ ảnh bìa bài đang phát (coverTint.ts)
  cover: {
    bg: '#101014',
    surface: '#1C1C22',
    card: 'rgba(28,28,34,0.6)',
    text: '#F5F5F7',
    textSecondary: '#ABABB5',
    accent: '#E0E0E6',
    onAccent: '#101014',
    border: 'rgba(255,255,255,0.12)',
    skeleton: 'rgba(255,255,255,0.08)',
    glass: 'rgba(24,24,30,0.58)',
    glassRgb: '24,24,30',
    glassTint: 'dark',
    statusBar: 'light-content',
    switchOff: '#3A3A44',
  },
};

export const PRESET_ORDER: ThemePresetId[] = ['dark', 'light', 'green', 'ocean', 'latte', 'snow', 'sakura', 'meteor', 'starry', 'aurora', 'rain', 'neon', 'cover'];
