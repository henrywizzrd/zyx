import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, GestureResponderEvent, Pressable, ScrollView, StyleSheet, Switch, Text, useColorScheme, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { systemPreset, useTheme } from '../theme/ThemeProvider';
import { useThemeTransition } from '../theme/ThemeTransition';
import { AMBIENT_PRESETS, AmbientPresetId, Palette, PRESET_ORDER, PRESETS, ThemePresetId } from '../theme/presets';
import type { BackgroundType } from '../theme/types';
import { useContentInsets } from '../components/FloatingDock';
import { Slider } from '../components/Slider';
import { useNav } from '../nav/Nav';
import { useAnimatedBack } from '../nav/SwipeBack';
import { useT } from '../i18n';
import { copyIntoApp, deleteAppFile } from '../data/files';
import { useScreenSize } from '../components/ScreenSize';

const PAD = 16;
const GAP = 12;

// Gọi fn nhiều nhất mỗi `ms` một lần trong lúc kéo thanh trượt (đổi theme làm cả app vẽ lại, gọi liên tục sẽ giật);
// lần cuối (khi nhả tay) luôn được áp dụng
function useThrottle<T>(fn: (v: T) => void, ms = 120) {
  const last = useRef(0);
  return {
    change: (v: T) => {
      const now = Date.now();
      if (now - last.current >= ms) {
        last.current = now;
        fn(v);
      }
    },
    commit: (v: T) => fn(v),
  };
}

// Màn hình thu nhỏ vẽ bằng màu của một bộ màu (tiêu đề, hai thẻ, hai dòng chữ, dock)
function MiniScreen({ p, id, width, h }: { p: Palette; id: ThemePresetId; width: number; h: number }) {
  return (
    <View style={{ width, height: h, backgroundColor: p.bg, padding: 12 }}>
      {/* Bộ Snow: vài bông tuyết; Latte: vài hạt cà phê; Ocean: vài bong bóng */}
      {id === 'snow' &&
        [[0.15, 0.1], [0.7, 0.18], [0.45, 0.32], [0.85, 0.45], [0.25, 0.55], [0.6, 0.62]].map(([x, y], i) => (
          <View key={i} style={{ position: 'absolute', left: x * width, top: y * h, width: 5, height: 5, borderRadius: 3, backgroundColor: '#C9D9EA' }} />
        ))}
      {id === 'latte' &&
        [[0.08, 0.06, 30], [0.82, 0.5, -20], [0.12, 0.66, 70]].map(([x, y, r], i) => (
          <View key={i} style={{ position: 'absolute', left: x * width, top: y * h, width: 7, height: 10, borderRadius: 5, backgroundColor: '#8A5A3B', opacity: 0.6, transform: [{ rotate: `${r}deg` }] }} />
        ))}
      {id === 'sakura' &&
        [[0.12, 0.08, 20], [0.78, 0.2, -30], [0.42, 0.46, 60], [0.86, 0.6, 10], [0.2, 0.7, -50]].map(([x, y, r], i) => (
          <View key={`s${i}`} style={{ position: 'absolute', left: x * width, top: y * h, width: 7, height: 9, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderBottomLeftRadius: 4, borderBottomRightRadius: 1, backgroundColor: '#F4A6BF', transform: [{ rotate: `${r}deg` }] }} />
        ))}
      {id === 'meteor' && (
        <>
          {[[0.12, 0.2], [0.8, 0.12], [0.5, 0.42], [0.3, 0.6], [0.9, 0.55], [0.65, 0.25]].map(([x, y], i) => (
            <View key={`m${i}`} style={{ position: 'absolute', left: x * width, top: y * h, width: 2, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF' }} />
          ))}
          <View style={{ position: 'absolute', left: width * 0.45, top: h * 0.22, width: width * 0.3, height: 1.2, backgroundColor: 'rgba(255,255,255,0.7)', transform: [{ rotate: '-38deg' }] }} />
        </>
      )}
      {id === 'aurora' && (
        <>
          <View style={{ position: 'absolute', left: -width * 0.1, top: h * 0.14, width: width * 1.2, height: h * 0.12, borderRadius: h, backgroundColor: 'rgba(61,245,160,0.35)', transform: [{ rotate: '-8deg' }] }} />
          <View style={{ position: 'absolute', left: -width * 0.1, top: h * 0.22, width: width * 1.2, height: h * 0.08, borderRadius: h, backgroundColor: 'rgba(155,108,255,0.3)', transform: [{ rotate: '5deg' }] }} />
          {[[0.15, 0.5], [0.8, 0.08], [0.6, 0.45], [0.35, 0.06]].map(([x, y], i) => (
            <View key={`a${i}`} style={{ position: 'absolute', left: x * width, top: y * h, width: 2, height: 2, borderRadius: 1, backgroundColor: '#FFFFFF' }} />
          ))}
        </>
      )}
      {id === 'rain' && (
        <>
          {[[0.1, 0.12, 3], [0.3, 0.4, 2], [0.7, 0.1, 4], [0.85, 0.35, 2], [0.5, 0.6, 3], [0.2, 0.7, 2], [0.62, 0.3, 2]].map(([x, y, r], i) => (
            <View key={`r${i}`} style={{ position: 'absolute', left: x * width, top: y * h, width: r * 2, height: r * 2.3, borderRadius: r, backgroundColor: 'rgba(255,255,255,0.22)' }} />
          ))}
          <View style={{ position: 'absolute', left: width * 0.78, top: h * 0.4, width: 2, height: h * 0.28, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.18)' }} />
        </>
      )}
      {id === 'neon' && (
        <>
          <View style={{ position: 'absolute', left: 0, right: 0, top: h * 0.62, height: 1.5, backgroundColor: '#FF7AE0' }} />
          {[0.72, 0.8, 0.9].map((y, i) => (
            <View key={`n${i}`} style={{ position: 'absolute', left: 0, right: 0, top: y * h, height: 1, backgroundColor: 'rgba(0,240,255,0.6)' }} />
          ))}
        </>
      )}
      {id === 'cover' && (
        <View style={{ position: 'absolute', right: 10, top: 10, flexDirection: 'row', gap: 3 }}>
          {['#E2574C', '#F2B134', '#3E8EDE'].map((c) => (
            <View key={c} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c }} />
          ))}
        </View>
      )}
      {id === 'ocean' &&
        [[0.85, 0.62, 6], [0.8, 0.5, 4], [0.86, 0.4, 3], [0.1, 0.58, 5]].map(([x, y, r], i) => (
          <View key={i} style={{ position: 'absolute', left: x * width, top: y * h, width: r, height: r, borderRadius: r, borderWidth: 1, borderColor: '#5B8FC9' }} />
        ))}
      <View style={{ width: '55%', height: 9, borderRadius: 5, backgroundColor: p.text }} />
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
        <View style={{ flex: 1, height: 28, borderRadius: 6, backgroundColor: p.surface }} />
        <View style={{ flex: 1, height: 28, borderRadius: 6, backgroundColor: p.surface }} />
      </View>
      <View style={{ width: '80%', height: 6, borderRadius: 3, backgroundColor: p.textSecondary, marginTop: 12, opacity: 0.7 }} />
      <View style={{ width: '60%', height: 6, borderRadius: 3, backgroundColor: p.textSecondary, marginTop: 6, opacity: 0.7 }} />
      {/* Dock thu nhỏ */}
      <View style={[styles.miniDock, { backgroundColor: p.glass, borderColor: p.border }]}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.accent }} />
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.textSecondary }} />
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.textSecondary }} />
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.textSecondary }} />
      </View>
    </View>
  );
}

// Thẻ chọn bộ màu. id = 'system': nửa trái là Dark, nửa phải là Light (theo sáng/tối của điện thoại)
function PresetCard({ id, selected, width, onPress }: {
  id: ThemePresetId | 'system'; selected: boolean; width: number; onPress: (e: GestureResponderEvent) => void;
}) {
  const { theme } = useTheme();
  const t = useT();
  const h = width * 1.2;
  return (
    <Pressable onPress={onPress} style={{ width }}>
      <View style={[styles.preview, { height: h, borderColor: selected ? theme.colors.accent : theme.colors.border, borderWidth: selected ? 2.5 : 1 }]}>
        {id === 'system' ? (
          <>
            <MiniScreen p={PRESETS.dark} id="dark" width={width} h={h} />
            {/* Nửa phải: cùng màn hình đó ở chế độ sáng */}
            <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: width / 2, overflow: 'hidden' }}>
              <View style={{ position: 'absolute', top: 0, right: 0 }}>
                <MiniScreen p={PRESETS.light} id="light" width={width} h={h} />
              </View>
            </View>
            <View style={[styles.systemBadge, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <Ionicons name="phone-portrait-outline" size={14} color={theme.colors.text} />
            </View>
          </>
        ) : (
          <MiniScreen p={PRESETS[id]} id={id} width={width} h={h} />
        )}
        {selected && (
          <View style={[styles.check, { backgroundColor: theme.colors.accent }]}>
            <Ionicons name="checkmark" size={14} color={theme.colors.onAccent} />
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700', marginTop: 8 }}>{t(`preset.${id}`)}</Text>
    </Pressable>
  );
}

// Trang Giao diện: bộ màu, nền (màu / ảnh / GIF / video), độ tối nền, độ mờ kính
export function ThemeStudioScreen() {
  const { theme, setBackground, setGlassBlur, setGlassMaterial, setAmbient } = useTheme();
  const { changePreset } = useThemeTransition();
  const scheme = useColorScheme();
  const t = useT();
  const pad = useContentInsets();
  const { width } = useScreenSize();
  const { pop } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  const [picking, setPicking] = useState<BackgroundType | null>(null);
  const { text, textSecondary, accent, onAccent, surface, border } = theme.colors;
  const bg = theme.background;
  const hasMedia = bg.type !== 'preset' && !!bg.uri;

  const dimS = useThrottle((v: number) => setBackground({ dim: Math.round(v * 0.8 * 100) / 100 }));
  const blurS = useThrottle((v: number) => setGlassBlur(Math.round(v * 100)));

  const cols = width >= 600 ? 3 : 2;
  const cardW = Math.floor((Math.min(width, 520) - PAD * 2 - GAP * (cols - 1)) / cols);

  // Chọn ảnh / GIF / video làm nền: chép vào thư mục của app, xoá file nền cũ
  const pickBg = async (kind: 'image' | 'video') => {
    try {
      setPicking(kind);
      const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: [kind === 'image' ? 'images' : 'videos'],
        quality: 1, // giữ nguyên chất lượng (và giữ GIF chuyển động)
        allowsEditing: false,
        videoMaxDuration: 120,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const uri = await copyIntoApp(res.assets[0].uri, 'background', kind);
      const old = bg.uri;
      setBackground({ type: kind, uri });
      if (old && old !== uri) deleteAppFile(old);
    } catch (e) {
      console.warn('[studio] pick', e);
      Alert.alert(t('studio.background'), t('studio.bgFailed'));
    } finally {
      setPicking(null);
    }
  };

  const bgChip = (type: BackgroundType, label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void) => {
    const on = type === 'preset' ? !hasMedia : hasMedia && bg.type === type;
    return (
      <Pressable key={type} onPress={onPress} style={[styles.chip, { backgroundColor: on ? accent : surface, borderColor: border }]}>
        {picking === type ? (
          <ActivityIndicator size="small" color={on ? onAccent : text} />
        ) : (
          <Ionicons name={icon} size={16} color={on ? onAccent : text} />
        )}
        <Text style={{ color: on ? onAccent : text, fontWeight: '700', fontSize: 13 }}>
          {label}
          {on && type !== 'preset' ? ` · ${t('studio.bgChange')}` : ''}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: pad.top + 8,
          paddingBottom: pad.bottom + pad.endPadding,
          paddingHorizontal: PAD,
          width: '100%',
          maxWidth: 520,
          alignSelf: 'center',
        }}
      >
        <View style={styles.topBar}>
          <Pressable onPress={goBack} hitSlop={10} style={[styles.circle, { backgroundColor: surface }]}>
            <Ionicons name="chevron-back" size={24} color={text} />
          </Pressable>
          <Text style={[styles.title, { color: text }]}>{t('studio.title')}</Text>
          <View style={{ width: 38 }} />
        </View>

        {/* Bộ màu */}
        <Text style={[styles.section, { color: text }]}>{t('studio.presets')}</Text>
        <Text style={{ color: textSecondary, fontSize: 13, marginBottom: 12 }}>{t('studio.presetsHint')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
          {/* Theo hệ thống: Light hoặc Dark tuỳ điện thoại đang để sáng hay tối */}
          <PresetCard
            id="system"
            width={cardW}
            selected={theme.followSystem}
            onPress={(e) => changePreset(systemPreset(scheme), { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, true)}
          />
          {PRESET_ORDER.map((id) => (
            <PresetCard
              key={id}
              id={id}
              width={cardW}
              selected={!theme.followSystem && theme.preset === id}
              onPress={(e) => changePreset(id, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            />
          ))}
        </View>

        {/* Hiệu ứng nền của bộ đang dùng (bộ nào có thì mới hiện). Bật/tắt được nhớ riêng cho từng bộ */}
        {(AMBIENT_PRESETS as ThemePresetId[]).includes(theme.preset) && (
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: text }]}>{t('studio.ambient')}</Text>
              <Text style={{ color: textSecondary, fontSize: 12, marginTop: 2 }}>
                {t(`studio.ambient.${theme.preset as AmbientPresetId}`)}
                {theme.preset !== 'latte' ? ` ${t('studio.ambientPause')}` : ''}
              </Text>
            </View>
            <Switch
              value={theme.effects.ambient[theme.preset as AmbientPresetId]}
              onValueChange={(on) => setAmbient(theme.preset as AmbientPresetId, on)}
              trackColor={{ true: accent, false: theme.colors.switchOff }}
            />
          </View>
        )}

        {theme.preset === 'cover' && <Text style={{ color: textSecondary, fontSize: 12, marginTop: 14 }}>{t('studio.coverHint')}</Text>}

        {/* Nền */}
        <Text style={[styles.section, { color: text }]}>{t('studio.background')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {bgChip('preset', t('studio.bgPreset'), 'color-palette-outline', () => setBackground({ type: 'preset' }))}
          {bgChip('image', t('studio.bgImage'), 'image-outline', () => pickBg('image'))}
          {bgChip('video', t('studio.bgVideo'), 'film-outline', () => pickBg('video'))}
        </View>
        <Text style={{ color: textSecondary, fontSize: 12, marginTop: 8 }}>{t('studio.bgHint')}</Text>

        {hasMedia && (
          <>
            <View style={styles.sliderHead}>
              <Text style={[styles.label, { color: text }]}>{t('studio.dim')}</Text>
              <Text style={{ color: textSecondary, fontSize: 13 }}>{Math.round((bg.dim / 0.8) * 100)}%</Text>
            </View>
            <Slider value={bg.dim / 0.8} thickness={6} fill={accent} track={border} onChange={dimS.change} onCommit={dimS.commit} />
          </>
        )}

        {/* Loại kính: Trong / Mờ / Khói (dock, mini player, bảng bật lên, thẻ...) */}
        <Text style={[styles.label, { color: text, marginTop: 18 }]}>{t('studio.material')}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {(['clear', 'frost', 'smoke'] as const).map((m) => {
            const on = (theme.glass.material ?? 'clear') === m;
            return (
              <Pressable
                key={m}
                onPress={() => setGlassMaterial(m)}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, borderCurve: 'continuous', backgroundColor: on ? accent : theme.colors.surface }}
              >
                <Text style={{ color: on ? theme.colors.onAccent : text, fontWeight: '700' }}>{t(`studio.material.${m}` as const)}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Kính mờ */}
        <View style={styles.sliderHead}>
          <Text style={[styles.label, { color: text }]}>{t('studio.blur')}</Text>
          <Text style={{ color: textSecondary, fontSize: 13 }}>{Math.round(theme.glass.blur)}</Text>
        </View>
        <Slider value={theme.glass.blur / 100} thickness={6} fill={accent} track={border} onChange={blurS.change} onCommit={blurS.commit} />
        <Text style={{ color: textSecondary, fontSize: 12, marginTop: 4 }}>{t('studio.blurHint')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  section: { fontSize: 18, fontWeight: '800', marginTop: 26, marginBottom: 6 },
  preview: { borderRadius: 14, overflow: 'hidden' },
  systemBadge: {
    position: 'absolute', left: '50%', top: '42%', marginLeft: -14, width: 28, height: 28, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center',
  },
  miniDock: {
    position: 'absolute', left: 12, right: 12, bottom: 12, height: 24, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
  },
  check: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  sliderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 },
  label: { fontSize: 15, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
});
