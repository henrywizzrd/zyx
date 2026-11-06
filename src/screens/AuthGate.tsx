import React, { useEffect, useState } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { syncSession, useSession } from '../data/auth';
import { AuthScreen } from './AuthScreen';

// Chưa đăng nhập (lần đầu mở app, hoặc vừa Đăng xuất) thì hiện màn đăng nhập, xong rồi mới vào app.
// "entered" phòng khi không lưu được phiên (vd. bản web không có SQLite): vẫn cho vào app trong lần mở này
export function AuthGate({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!session) setEntered(false); // vừa đăng xuất
  }, [session]);
  // Mở app: khớp lại với server (phiên hết hạn / bị đăng xuất ở chỗ khác thì quay về màn đăng nhập)
  useEffect(() => {
    syncSession();
  }, []);

  if (!session && !entered) return <AuthScreen onDone={() => setEntered(true)} />;
  return (
    <Animated.View entering={FadeIn.duration(350)} style={{ flex: 1 }}>
      {children}
    </Animated.View>
  );
}
