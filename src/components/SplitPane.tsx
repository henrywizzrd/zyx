import React from 'react';
import { ScrollView, StyleProp, View, ViewStyle } from 'react-native';
import { useContentInsets } from './FloatingDock';

// Màn hình ngang: chia đôi thành hai cột, MỖI CỘT CUỘN RIÊNG (cuộn bên này thì bên kia đứng yên), không hiện thanh cuộn.
// left / right: nội dung từng cột. ratio: bề rộng cột trái (0..1). pad: lề trong mỗi cột.
// leftFixed: cột trái không cuộn (vd. trang Profile có ảnh bìa cố định) — tự lo bố cục bên trong
export function SplitPane({
  left,
  right,
  ratio = 0.5,
  pad = 16,
  gap = 8,
  leftFixed,
  leftStyle,
  topExtra = 12,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  ratio?: number;
  pad?: number;
  gap?: number;
  leftFixed?: boolean;
  leftStyle?: StyleProp<ViewStyle>;
  topExtra?: number;
}) {
  const insets = useContentInsets();
  const content = { paddingTop: insets.top + topExtra, paddingBottom: insets.bottom + insets.endPadding, paddingHorizontal: pad };
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap }}>
      {leftFixed ? (
        <View style={[{ flex: ratio }, leftStyle]}>{left}</View>
      ) : (
        <ScrollView style={[{ flex: ratio }, leftStyle]} contentContainerStyle={content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {left}
        </ScrollView>
      )}
      <ScrollView style={{ flex: 1 - ratio }} contentContainerStyle={content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {right}
      </ScrollView>
    </View>
  );
}
