import React, { Suspense, useRef } from 'react';

// "Đóng băng" một phần giao diện đang bị ẩn: React bỏ qua không vẽ lại nó nữa cho tới khi hiện lại.
// Dùng cho các tab đang ẩn và các trang nằm sâu trong chồng: trước đây chúng vẫn bị vẽ lại mỗi khi trạng thái phát nhạc đổi
// (bấm lặp / trộn bài, đổi bài...), dù không ai nhìn thấy → tụt khung hình.
// Cách làm giống thư viện react-freeze (react-native-screens dùng): phần bị đóng băng "chờ" một lời hứa chưa xong,
// React giữ nguyên nó trên màn hình (đang ẩn sẵn) và không chạy lại.
type Pending = { promise?: Promise<void>; resolve?: () => void };

function Suspender({ freeze, children }: { freeze: boolean; children: React.ReactNode }) {
  const p = useRef<Pending>({}).current;
  if (freeze) {
    if (!p.promise) p.promise = new Promise<void>((r) => (p.resolve = r));
    throw p.promise;
  }
  if (p.promise) {
    p.resolve?.();
    p.promise = undefined;
    p.resolve = undefined;
  }
  return <>{children}</>;
}

export function Freeze({ freeze, children }: { freeze: boolean; children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Suspender freeze={freeze}>{children}</Suspender>
    </Suspense>
  );
}
