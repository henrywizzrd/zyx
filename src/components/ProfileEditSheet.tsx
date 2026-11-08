import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { GlassFill } from './Glass';
import { useT } from '../i18n';

const USE_NATIVE = Platform.OS !== 'web';
const NAME_MAX = 30;
const TAG_MAX = 20;

// Hashtag chỉ gồm chữ, số và dấu gạch dưới (bỏ dấu #, khoảng trắng, ký tự lạ người dùng gõ vào)
// (liệt kê thẳng dải chữ có dấu thay vì \p{L}, vì không chắc bộ máy JS của app hỗ trợ)
const cleanTag = (v: string) => v.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '').slice(0, TAG_MAX);

// Popup sửa tên và hashtag: nảy lên từ dưới, nền phía sau mờ nhẹ.
// Hai ô đặt cạnh nhau, điền sẵn giá trị hiện tại; chữ gợi ý "Username" / "Hashtag" chỉ hiện khi ô trống.
export function ProfileEditSheet({
  visible,
  name,
  tag,
  onClose,
  onSave,
}: {
  visible: boolean;
  name: string;
  tag: string;
  onClose: () => void;
  onSave: (name: string, tag: string) => void;
}) {
  const { theme } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { text, textSecondary, accent, border, skeleton, onAccent, glassTint } = theme.colors;

  const [nameV, setNameV] = useState(name);
  const [tagV, setTagV] = useState(tag);
  const [mounted, setMounted] = useState(visible);

  // Mỗi lần mở: điền lại giá trị đang có
  useEffect(() => {
    if (visible) {
      setNameV(name);
      setTagV(tag);
    }
  }, [visible, name, tag]);

  // 0 = ẩn dưới đáy, 1 = hiện. Mở: lò xo nảy nhẹ. Đóng: trượt xuống.
  const show = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      show.setValue(0);
      Animated.spring(show, { toValue: 1, friction: 7, tension: 70, overshootClamping: true, useNativeDriver: USE_NATIVE }).start();
    } else if (mounted) {
      Animated.timing(show, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: USE_NATIVE }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = nameV.trim();
  const canSave = n.length > 0 && tagV.length > 0 && (n !== name || tagV !== tag);
  const save = () => {
    if (!canSave) return;
    onSave(n, tagV);
  };

  if (!mounted) return null;

  const translateY = show.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Nền mờ nhẹ, bấm ra ngoài để đóng */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: show }]}>
        <BlurView intensity={25} tint={glassTint} style={StyleSheet.absoluteFill} />
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} onPress={onClose} />
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            { marginBottom: Math.max(insets.bottom, 12) + 4, transform: [{ translateY }] },
          ]}
        >
          <GlassFill radius={24} solid={0.85} slab />
          <Text style={[styles.title, { color: text }]}>{t('profile.edit')}</Text>

          <View style={styles.row}>
            {/* Tên */}
            <View style={[styles.box, { flex: 1.25, borderColor: border, backgroundColor: skeleton }]}>
              <TextInput
                value={nameV}
                onChangeText={(v) => setNameV(v.slice(0, NAME_MAX))}
                placeholder={t('profile.username')}
                placeholderTextColor={textSecondary}
                autoCorrect={false}
                returnKeyType="next"
                style={[styles.input, { color: text }]}
              />
            </View>

            {/* Hashtag: dấu # xám cố định sát trái, người dùng gõ phần còn lại */}
            <View style={[styles.box, { flex: 1, borderColor: border, backgroundColor: skeleton, flexDirection: 'row', alignItems: 'center' }]}>
              <Text style={[styles.hash, { color: textSecondary }]}>#</Text>
              <TextInput
                value={tagV}
                onChangeText={(v) => setTagV(cleanTag(v))}
                placeholder={t('profile.hashtag')}
                placeholderTextColor={textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={save}
                style={[styles.input, { color: text, flex: 1, paddingLeft: 2 }]}
              />
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.btn}>
              <Text style={{ color: textSecondary, fontSize: 15, fontWeight: '700' }}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable onPress={save} disabled={!canSave} style={[styles.btn, styles.saveBtn, { backgroundColor: accent, opacity: canSave ? 1 : 0.4 }]}>
              <Text style={{ color: onAccent, fontSize: 15, fontWeight: '800' }}>{t('profile.save')}</Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, borderRadius: 24, borderCurve: 'continuous', padding: 16, boxShadow: '0px 2px 4px rgba(0,0,0,0.35), 0px 14px 36px rgba(0,0,0,0.3)' },
  title: { fontSize: 17, fontWeight: '800', marginBottom: 14 },
  row: { flexDirection: 'row', gap: 10 },
  box: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 48, justifyContent: 'center' },
  input: { fontSize: 15, fontWeight: '600', paddingVertical: 0 },
  hash: { fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 16 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  saveBtn: { paddingHorizontal: 22 },
});
