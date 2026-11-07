import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import RNMaskedView from '@react-native-masked-view/masked-view';

const MaskedView = RNMaskedView as unknown as React.ComponentType<any>;

// Làm phần dưới của ảnh đầu trang (ảnh bìa album, ảnh nghệ sĩ...) TRONG SUỐT dần, tan hẳn vào nền phía sau.
// Trước đây phủ một dải đúng màu nền lên đáy ảnh: nền có hoạ tiết (trời sao, hoa rơi, ảnh / video) thì lộ thành một đường cắt ngang.
// from: từ đâu (0..1 theo chiều cao) bắt đầu mờ dần
export function FadeBottom({ children, from = 0.5 }: { children: React.ReactNode; from?: number }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return (
    <MaskedView
      style={StyleSheet.absoluteFill}
      maskElement={<LinearGradient colors={['#000', '#000', 'transparent']} locations={[0, from, 1]} style={{ flex: 1 }} />}
    >
      {children}
    </MaskedView>
  );
}
