// Hạt cà phê trang trí cho bộ Latte (đứng yên, không chuyển động).
// Hình trong khung: hạt hình bầu dục dựng đứng (cao 2, rộng ~1.36), rãnh giữa hình chữ S khoét rỗng (tô kiểu even-odd).

export const BEAN_SVG =
  // Thân hạt
  'M0 -1C0.62 -1 0.7 -0.45 0.68 0C0.66 0.5 0.55 1 0 1C-0.55 1 -0.66 0.5 -0.68 0C-0.7 -0.45 -0.62 -1 0 -1Z' +
  // Rãnh chữ S
  'M0.04 -0.86C-0.3 -0.45 0.3 0.4 -0.06 0.86C-0.12 0.84 -0.13 0.8 -0.1 0.76C0.17 0.35 -0.4 -0.42 -0.03 -0.85C0 -0.88 0.03 -0.88 0.04 -0.86Z';

// Vị trí hạt (tỉ lệ theo màn hình), góc xoay (độ), kích thước (nửa chiều cao, px).
// Đặt chủ yếu sát mép và các góc, vài chỗ đi thành cặp cho tự nhiên; nằm sau nội dung nên không che chữ
export const BEANS: [x: number, y: number, rot: number, size: number][] = [
  [0.06, 0.1, -25, 13], [0.13, 0.13, 40, 10],
  [0.93, 0.22, 20, 14],
  [0.04, 0.44, 70, 11],
  [0.95, 0.52, -35, 12], [0.89, 0.555, 15, 9],
  [0.08, 0.74, -10, 14],
  [0.92, 0.84, 55, 13],
  [0.5, 0.965, -60, 11], [0.57, 0.95, 10, 9],
  [0.32, 0.04, 80, 10],
];

// Hai sắc nâu xen kẽ: rang vừa và rang đậm
export const BEAN_COLORS = ['#8A5A3B', '#6B4128'];
