import { useWindowDimensions, ViewStyle } from 'react-native';import { EdgeInsets } from 'react-native-safe-area-context';
import { Edge, MiniAnchor, Position, Theme } from '../theme/types';

// Kích thước và vị trí của "khung điện thoại" trong cửa sổ
export function useFrame() {
  const { width, height } = useWindowDimensions();
  return { width, height, left: 0 };
}

export const ITEM_SIZE = 52;
export const DOCK_PADDING = 8;
export const DOCK_GAP = 6;
export const DOCK_THICKNESS = ITEM_SIZE + DOCK_PADDING * 2;

export const MP_ALBUM = 44;
export const MP_BUTTON = 40;
export const MP_PADDING = 8;
export const MP_GAP = 6;
export const MP_THICKNESS = MP_ALBUM + MP_PADDING * 2;

export const STACK_GAP = 10;

// Chỉ top và bottom nằm ngang, mọi vị trí còn lại xếp dọc
export const isVertical = (p: Position) => p !== 'top' && p !== 'bottom';

export function dockSize(count: number, position: Position) {
  const length = count * ITEM_SIZE + (count - 1) * DOCK_GAP + DOCK_PADDING * 2;
  return isVertical(position)
    ? { width: DOCK_THICKNESS, height: length }
    : { width: length, height: DOCK_THICKNESS };
}

// offset: đẩy thêm theo trục dọc (dùng khi xếp chồng 2 khối cùng vị trí)
function place(position: Position, insets: EdgeInsets, m: number, offset = 0): ViewStyle {
  const top = insets.top + m;
  const bottom = insets.bottom + m;
  const left = insets.left + m;
  const right = insets.right + m;

  switch (position) {
    case 'bottom':
      return { left: 0, right: 0, bottom: bottom + offset, alignItems: 'center' };
    case 'top':
      return { left: 0, right: 0, top: top + offset, alignItems: 'center' };
    case 'left':
      return { top: 0, bottom: 0, left, justifyContent: 'center' };
    case 'right':
      return { top: 0, bottom: 0, right, justifyContent: 'center' };
    case 'top-left':
      return { top: top + offset, left };
    case 'top-right':
      return { top: top + offset, right };
    case 'bottom-left':
      return { bottom: bottom + offset, left };
    case 'bottom-right':
      return { bottom: bottom + offset, right };
  }
}

export type Rect = { x: number; y: number; w: number; h: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const FULL_LENGTH = MP_ALBUM + 3 * MP_BUTTON + 3 * MP_GAP + MP_PADDING * 2;
export const edgeVertical = (e: Edge) => e === 'left' || e === 'right';

// Kích thước mini player: dạng đầy đủ (thanh dài) hoặc dạng bubble (hình tròn / vuông bo góc)
export function miniSize(edge: Edge, collapsed: boolean) {
  if (collapsed) return { w: MP_THICKNESS, h: MP_THICKNESS };
  return edgeVertical(edge) ? { w: MP_THICKNESS, h: FULL_LENGTH } : { w: FULL_LENGTH, h: MP_THICKNESS };
}

// Hình chữ nhật mà dock đang chiếm trên màn hình
export function dockRect(theme: Theme, insets: EdgeInsets, W: number, H: number): Rect {
  const { dock, miniPlayer } = theme;
  const m = dock.style.margin;
  const count = dock.items.length + (miniPlayer.merged ? 1 : 0);
  const { width: w, height: h } = dockSize(count, dock.position);
  const L = insets.left + m, R = W - insets.right - m, T = insets.top + m, B = H - insets.bottom - m;
  switch (dock.position) {
    case 'bottom': return { x: (W - w) / 2, y: B - h, w, h };
    case 'top': return { x: (W - w) / 2, y: T, w, h };
    case 'left': return { x: L, y: (H - h) / 2, w, h };
    case 'right': return { x: R - w, y: (H - h) / 2, w, h };
    case 'top-left': return { x: L, y: T, w, h };
    case 'top-right': return { x: R - w, y: T, w, h };
    case 'bottom-left': return { x: L, y: B - h, w, h };
    case 'bottom-right': return { x: R - w, y: B - h, w, h };
  }
}

export type MiniRect = Rect & { vertical: boolean };

// Vị trí cuối cùng của mini player: dán vào viền theo anchor, rồi tránh dock nếu bị trùng.
//  - Dock nằm giữa một cạnh (bottom/top/left/right) và mini player thả cùng cạnh đó: xếp ngay phía trong dock, canh giữa dock.
//  - Dock ở góc (thanh dọc): thả ở cạnh trên/dưới sát dock thì mini player đứng dọc ngay cạnh dock, cùng đầu với dock.
//    Thả ở cạnh của dock thì trượt dọc theo cạnh tới sát dock.
// vertical = mini player đang đứng dọc hay nằm ngang (bubble thì vẫn nhớ hướng để lúc dãn ra đúng hướng).
export function resolveMini(theme: Theme, insets: EdgeInsets, W: number, H: number, anchor: MiniAnchor, collapsed: boolean): MiniRect {
  const m = theme.dock.style.margin;
  const gap = STACK_GAP;
  const { w, h } = miniSize(anchor.edge, collapsed);
  const L = insets.left + m, R = W - insets.right - m, T = insets.top + m, B = H - insets.bottom - m;
  const half = MP_THICKNESS / 2;
  const t = clamp(anchor.t, 0, 1);
  const horizontal = !edgeVertical(anchor.edge);
  const out = (r: Rect, vertical: boolean): MiniRect => ({ ...r, vertical });

  // Tâm của mini player chạy trong khoảng [đầu + nửa bubble, cuối - nửa bubble] nên bubble và thanh dài cùng một tọa độ t
  let x: number, y: number;
  if (horizontal) {
    x = clamp(L + half + t * (R - L - MP_THICKNESS) - w / 2, L, Math.max(L, R - w));
    y = anchor.edge === 'top' ? T : B - h;
  } else {
    y = clamp(T + half + t * (B - T - MP_THICKNESS) - h / 2, T, Math.max(T, B - h));
    x = anchor.edge === 'left' ? L : R - w;
  }
  const rect: Rect = { x, y, w, h };
  if (theme.miniPlayer.merged) return out(rect, !horizontal);

  const dock = dockRect(theme, insets, W, H);
  const hit = rect.x < dock.x + dock.w + gap && rect.x + w + gap > dock.x && rect.y < dock.y + dock.h + gap && rect.y + h + gap > dock.y;
  if (!hit) return out(rect, !horizontal);

  const fit = (r: Rect): Rect => ({ ...r, x: clamp(r.x, L, Math.max(L, R - r.w)), y: clamp(r.y, T, Math.max(T, B - r.h)) });
  const dp = theme.dock.position;

  if (dp === anchor.edge) {
    switch (anchor.edge) {
      case 'bottom': return out(fit({ x: dock.x + dock.w / 2 - w / 2, y: dock.y - gap - h, w, h }), false);
      case 'top': return out(fit({ x: dock.x + dock.w / 2 - w / 2, y: dock.y + dock.h + gap, w, h }), false);
      case 'left': return out(fit({ x: dock.x + dock.w + gap, y: dock.y + dock.h / 2 - h / 2, w, h }), true);
      case 'right': return out(fit({ x: dock.x - gap - w, y: dock.y + dock.h / 2 - h / 2, w, h }), true);
    }
  }

  // Dock ở góc, mini player đang nằm ngang ở cạnh trên/dưới: đứng dọc ngay cạnh dock, cùng đầu với dock
  const cornerDock = dp !== 'top' && dp !== 'bottom' && dp !== 'left' && dp !== 'right';
  if (cornerDock && horizontal) {
    const vs = collapsed ? { w: MP_THICKNESS, h: MP_THICKNESS } : { w: MP_THICKNESS, h: FULL_LENGTH };
    const onLeft = dp.endsWith('left');
    const onTop = dp.startsWith('top');
    return out(
      fit({
        x: onLeft ? dock.x + dock.w + gap : dock.x - gap - vs.w,
        y: onTop ? dock.y : dock.y + dock.h - vs.h,
        w: vs.w,
        h: vs.h,
      }),
      true
    );
  }

  // Trượt dọc theo cạnh sang phía nào còn chỗ và gần hơn
  if (horizontal) {
    const options = [dock.x - gap - w, dock.x + dock.w + gap].filter((c) => c >= L - 0.5 && c <= R - w + 0.5);
    if (options.length) {
      const best = options.reduce((a, b) => (Math.abs(a - rect.x) <= Math.abs(b - rect.x) ? a : b));
      return out({ ...rect, x: best }, false);
    }
  } else {
    const options = [dock.y - gap - h, dock.y + dock.h + gap].filter((c) => c >= T - 0.5 && c <= B - h + 0.5);
    if (options.length) {
      const best = options.reduce((a, b) => (Math.abs(a - rect.y) <= Math.abs(b - rect.y) ? a : b));
      return out({ ...rect, y: best }, true);
    }
  }

  // Không còn chỗ để trượt: lùi vào phía trong dock
  switch (anchor.edge) {
    case 'bottom': return out(fit({ ...rect, y: dock.y - gap - h }), false);
    case 'top': return out(fit({ ...rect, y: dock.y + dock.h + gap }), false);
    case 'left': return out(fit({ ...rect, x: dock.x + dock.w + gap }), true);
    case 'right': return out(fit({ ...rect, x: dock.x - gap - w }), true);
  }
}

// Từ điểm ngón tay đang ở, tìm cạnh gần nhất và vị trí dọc theo cạnh đó.
// prev: cạnh đang chọn. Gần góc thì giữ cạnh cũ trừ khi cạnh kia gần hơn hẳn, để không nhảy qua lại giữa hai cạnh.
export function targetAnchor(px: number, py: number, W: number, H: number, insets: EdgeInsets, m: number, prev?: Edge): MiniAnchor {
  const d: Record<Edge, number> = { left: px, right: W - px, top: py, bottom: H - py };
  let edge = (Object.keys(d) as Edge[]).reduce((a, b) => (d[a] <= d[b] ? a : b));
  if (prev && prev !== edge && d[prev] <= d[edge] + 40) edge = prev;
  const half = MP_THICKNESS / 2;
  const L = insets.left + m, R = W - insets.right - m, T = insets.top + m, B = H - insets.bottom - m;
  const [lo, hi, v] = edgeVertical(edge) ? [T + half, B - half, py] : [L + half, R - half, px];
  return { edge, t: hi > lo ? clamp((v - lo) / (hi - lo), 0, 1) : 0.5 };
}

// Chỉ dock còn dùng cách định vị cũ (8 vị trí cố định)
export function computeLayout(theme: Theme, insets: EdgeInsets) {
  return { dockStyle: place(theme.dock.position, insets, theme.dock.style.margin) };
}

// Chia màn hình thành lưới 3x3. Ô giữa thì chọn cạnh gần nhất.
export function targetPosition(x: number, y: number, w: number, h: number): Position {
  const col = x < w / 3 ? 0 : x > (w * 2) / 3 ? 2 : 1;
  const row = y < h / 3 ? 0 : y > (h * 2) / 3 ? 2 : 1;

  if (row === 0) return col === 0 ? 'top-left' : col === 2 ? 'top-right' : 'top';
  if (row === 2) return col === 0 ? 'bottom-left' : col === 2 ? 'bottom-right' : 'bottom';
  if (col === 0) return 'left';
  if (col === 2) return 'right';

  const d = { left: x, right: w - x, top: y, bottom: h - y };
  return (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[a] <= d[b] ? a : b));
}
