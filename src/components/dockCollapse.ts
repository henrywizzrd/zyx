// Dock kiểu Apple Music: cuộn xuống thì thu dock (thanh tab thành nút tròn, mini player chui xuống nằm cạnh),
// cuộn lên / về đầu trang thì mở lại. Tính hoàn toàn trên luồng giao diện (worklet), không đụng luồng JS khi cuộn.
import { makeMutable, SharedValue, useAnimatedReaction, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { beginMotionAny, endMotion } from './JankMonitor';

export const DOCK_SPRING = { stiffness: 300, damping: 28, mass: 1 };
export const dockCollapse = makeMutable(0); // 0 = dock đầy đủ, 1 = đã thu (giá trị đang chạy, có lò xo)
const target = makeMutable(0);

export function setDockCollapsed(on: boolean) {
  'worklet';
  const v = on ? 1 : 0;
  if (target.value === v) return;
  target.value = v;
  // ghi vào mục Chuyển động của Nhật ký (gọi được từ cả luồng giao diện lẫn luồng JS)
  beginMotionAny(on ? 'thu dock' : 'mở dock');
  dockCollapse.value = withSpring(v, DOCK_SPRING, (done) => {
    if (done) scheduleOnRN(endMotion, '');
  });
}

// Gắn vào vị trí cuộn của một trang (scrollY là shared value, đơn vị điểm)
export function useDockCollapse(scrollY: SharedValue<number>) {
  useAnimatedReaction(
    () => scrollY.value,
    (y, prev) => {
      if (prev == null) return;
      const d = y - prev;
      if (y < 30) setDockCollapsed(false);
      else if (d > 4) setDockCollapsed(true);
      else if (d < -6) setDockCollapsed(false);
    }
  );
}
