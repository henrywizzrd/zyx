import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
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
import { useRenderProbe } from '../components/JankMonitor';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { SMOKE_COLORS, SMOKE_TONES, type SmokeTone } from '../theme/smokeTones';
import { Group, GROUP_COLORS, PageHeader, Row, Seg, Toggle } from '../components/SettingsUI';
import { GlassFill, glassShadow } from '../components/Glass';
import { POP_LINES, POP_PATTERNS, POP_SHADOW_COLORS, POP_SHADOWS, POP_THEME_NAMES, POP_THEME_ORDER, POP_THEMES, popSystemTheme, type PopThemeId } from '../theme/pop';

const PAD = 16;

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


// Theme tile (28/11, same size and layout as the Pop tiles): the theme's background, its accent as a dot and a glass bar
// like the dock. id = 'system': left half Dark, right half Light (follows the phone)
function GlassTile({ id, selected, size, onPress }: { id: ThemePresetId | 'system'; selected: boolean; size: number; onPress: (e: GestureResponderEvent) => void }) {
  const { theme } = useTheme();
  const t = useT();
  const face = (p: Palette) => (
    <>
      <View style={{ position: 'absolute', right: '12%', top: '12%', width: '26%', aspectRatio: 1, borderRadius: 99, backgroundColor: p.accent }} />
      <View style={{ position: 'absolute', left: '18%', right: '18%', bottom: '16%', height: '24%', borderRadius: 99, backgroundColor: p.glass, borderWidth: 1, borderColor: p.border }} />
    </>
  );
  return (
    <Pressable onPress={onPress} style={{ width: size, alignItems: 'center' }} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={t(`preset.${id}`)}>
      <View
        style={[
          { width: size, height: size, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
          selected && { outlineWidth: 3, outlineColor: theme.colors.text, outlineOffset: 2 },
        ]}
      >
        {id === 'system' ? (
          <>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%', backgroundColor: PRESETS.dark.bg }} />
            <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', backgroundColor: PRESETS.light.bg }} />
            <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View style={[styles.systemBadge, { position: 'relative', left: 0, top: 0, marginLeft: 0, backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Ionicons name="phone-portrait-outline" size={14} color={theme.colors.text} />
              </View>
            </View>
          </>
        ) : id === 'cover' ? (
          <View style={{ flex: 1, backgroundColor: PRESETS.cover.bg }}>
            <View style={{ position: 'absolute', left: '14%', top: '16%', flexDirection: 'row', gap: 3 }}>
              {['#E2574C', '#F2B134', '#3E8EDE'].map((c) => (
                <View key={c} style={{ width: size * 0.14, height: size * 0.14, borderRadius: 99, backgroundColor: c }} />
              ))}
            </View>
            {face(PRESETS.cover)}
          </View>
        ) : (
          <View style={{ flex: 1, backgroundColor: PRESETS[id].bg }}>{face(PRESETS[id])}</View>
        )}
      </View>
      <Text numberOfLines={1} style={{ color: theme.colors.text, fontSize: 12, fontWeight: '800', marginTop: 6 }}>{t(`preset.${id}`)}</Text>
    </Pressable>
  );
}

// Trang Giao diện: bộ màu, nền (màu / ảnh / GIF / video), độ tối nền, độ mờ kính
// Màu đèn neon cho loại kính Neon ('' = theo màu nhấn của theme)
const NEON_COLORS = ['', '#7EF0FF', '#FF5FD2', '#B78CFF', '#6CFF9E', '#FFD15C', '#FF8A3D', '#FF4D6D'];

export function ThemeStudioScreen() {
  const { theme, setBackground, setGlassBlur, setGlassMaterial, setGlassNeon, setAmbient, setMeteorLevel, setSmokeTone, setSmokeSpeed } = useTheme();
  const { changePreset } = useThemeTransition();
  const scheme = useColorScheme();
  const t = useT();
  const pad = useContentInsets();
  const { width } = useScreenSize();
  const { pop } = useNav();
  const goBack = useAnimatedBack() ?? pop;
  const [picking, setPicking] = useState<BackgroundType | null>(null);
  const { text, textSecondary, accent, border } = theme.colors;
  const bg = theme.background;
  const hasMedia = bg.type !== 'preset' && !!bg.uri;
  useRenderProbe('Giao diện (studio)', { theme, width, picking, pad });

  const dimS = useThrottle((v: number) => setBackground({ dim: Math.round(v * 0.8 * 100) / 100 }));
  const blurS = useThrottle((v: number) => setGlassBlur(Math.round(v * 100)));
  // thanh 0..1 ↔ tốc độ khói 0.3..2
  const smokeS = useThrottle((v: number) => setSmokeSpeed(0.3 + v * 1.7));
  const smokeSpeed = theme.effects.smokeSpeed ?? 1;

  const tile = Math.floor((Math.min(width, 520) - PAD * 2 - 10 * 3) / 4); // 4 tiles a row, same as the Pop side

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

  return (
    <View style={StyleSheet.absoluteFill}>
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: pad.top + 8,
          paddingBottom: pad.bottom + pad.endPadding,
          paddingHorizontal: PAD,
          width: '100%',
          maxWidth: 520,
          alignSelf: 'center',
        }}
      >
        <PageHeader title={t('studio.title')} />

        {/* Default (glass) or Pop: each side has its own themes and options, and remembers them */}
        <KindSwitch />

        {theme.style === 'pop' ? (
          <PopPane />
        ) : (
        <>
        {/* Themes: compact tiles like the Pop side (28/11). First tile = follow the phone (Dark / Light) */}
        <Text style={[styles.section, { color: text }]}>{t('studio.presets')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
          <GlassTile
            id="system"
            size={tile}
            selected={theme.followSystem}
            onPress={(e) => changePreset(systemPreset(scheme), { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, true)}
          />
          {PRESET_ORDER.map((id) => (
            <GlassTile
              key={id}
              id={id}
              size={tile}
              selected={!theme.followSystem && theme.preset === id}
              onPress={(e) => changePreset(id, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            />
          ))}
        </View>
        {theme.preset === 'cover' && <Text style={{ color: textSecondary, fontSize: 12, marginTop: 10 }}>{t('studio.coverHint')}</Text>}

        {/* Look: background effect, glass type, glass blur — rows like the Pop side */}
        <Group label={t('studio.popLook')} color={GROUP_COLORS.yellow} style={{ marginTop: 34 }}>
          {(AMBIENT_PRESETS as ThemePresetId[]).includes(theme.preset) && (
            <Row
              first
              title={t('studio.ambient')}
              hint={`${t(`studio.ambient.${theme.preset as AmbientPresetId}`)}${theme.preset !== 'latte' ? ` ${t('studio.ambientPause')}` : ''}`}
              right={<Toggle value={theme.effects.ambient[theme.preset as AmbientPresetId]} onChange={(on) => setAmbient(theme.preset as AmbientPresetId, on)} />}
            />
          )}
          {theme.preset === 'meteor' && theme.effects.ambient.meteor && (
            <Row
              title={t('studio.meteorLevel')}
              right={
                <Seg
                  options={['0', '1', '2', '3'] as const}
                  value={String(theme.effects.meteorLevel ?? 1) as '0' | '1' | '2' | '3'}
                  onSelect={(v) => setMeteorLevel(Number(v) as 0 | 1 | 2 | 3)}
                  labels={{ '0': t('studio.meteorLevel.0'), '1': t('studio.meteorLevel.1'), '2': t('studio.meteorLevel.2'), '3': t('studio.meteorLevel.3') }}
                />
              }
            />
          )}
          {theme.preset === 'smoke' && (
            <View style={styles.block}>
              <Text style={[styles.label, { color: text }]}>{t('studio.smokeTone')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                {SMOKE_TONES.map((tone) => (
                  <ToneChip
                    key={tone}
                    tone={tone}
                    label={t(`studio.smokeTone.${tone}`)}
                    on={(theme.effects.smokeTone ?? 'coffee') === tone}
                    ring={accent}
                    text={text}
                    dim={textSecondary}
                    onPress={() => setSmokeTone(tone)}
                  />
                ))}
              </View>
              {(theme.effects.smokeTone ?? 'coffee') === 'cover' && <Text style={{ color: textSecondary, fontSize: 12, marginTop: 8 }}>{t('studio.coverHint')}</Text>}
              {theme.effects.ambient.smoke && (
                <>
                  <View style={styles.sliderHead}>
                    <Text style={[styles.label, { color: text }]}>{t('studio.smokeSpeed')}</Text>
                    <Text style={{ color: textSecondary, fontSize: 13 }}>{smokeSpeed.toFixed(1)}×</Text>
                  </View>
                  <Slider value={(smokeSpeed - 0.3) / 1.7} thickness={6} fill={accent} track={border} onChange={smokeS.change} onCommit={smokeS.commit} />
                </>
              )}
            </View>
          )}
          <Row
            first={!(AMBIENT_PRESETS as ThemePresetId[]).includes(theme.preset) && theme.preset !== 'smoke'}
            title={t('studio.material')}
            right={
              <Seg
                options={['clear', 'frost', 'neon'] as const}
                value={theme.glass.material ?? 'clear'}
                onSelect={(m) => {
                  setGlassMaterial(m);
                  // Frosted starts thin (light blur); the Glass blur slider makes it thicker
                  if (m === 'frost' && (theme.glass.material ?? 'clear') !== 'frost') setGlassBlur(15);
                }}
                labels={{ clear: t('studio.material.clear'), frost: t('studio.material.frost'), neon: t('studio.material.neon') }}
              />
            }
          />
          {/* Neon: light colour (first = the theme's accent). Each dot glows in its own colour */}
          {theme.glass.material === 'neon' && (
            <View style={[styles.block, { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }]}>
              {NEON_COLORS.map((c) => {
                const col = c || accent;
                const on = (theme.glass.neon ?? '') === c;
                return (
                  <Pressable
                    key={c || 'auto'}
                    onPress={() => setGlassNeon(c)}
                    hitSlop={6}
                    accessibilityLabel={c || t('studio.neon.auto')}
                    style={{
                      width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: 'rgba(8,8,20,0.6)', borderWidth: on ? 2 : 1, borderColor: col,
                      boxShadow: `0px 0px ${on ? 14 : 7}px ${col}`,
                    }}
                  >
                    {c === '' ? <Text style={{ color: col, fontSize: 11, fontWeight: '800' }}>A</Text> : <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: col, boxShadow: `0px 0px 6px ${col}` }} />}
                  </Pressable>
                );
              })}
            </View>
          )}
          <View style={[styles.block, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }]}>
            <View style={[styles.sliderHead, { marginTop: 0 }]}>
              <Text style={[styles.label, { color: text }]}>{t('studio.blur')}</Text>
              <Text style={{ color: textSecondary, fontSize: 13 }}>{Math.round(theme.glass.blur)}</Text>
            </View>
            <Slider value={theme.glass.blur / 100} thickness={6} fill={accent} track={border} onChange={blurS.change} onCommit={blurS.commit} />
            <Text style={{ color: textSecondary, fontSize: 12, marginTop: 6 }}>{t('studio.blurHint')}</Text>
          </View>
        </Group>

        {/* Background: the theme's own, or your photo / GIF / video */}
        <Group label={t('studio.background')} color={GROUP_COLORS.sky}>
          <Row
            first
            title={t('studio.background')}
            hint={t('studio.bgHint')}
            right={
              picking ? (
                <ActivityIndicator color={text} />
              ) : (
                <Seg
                  options={['preset', 'image', 'video'] as const}
                  value={hasMedia ? (bg.type as 'image' | 'video') : 'preset'}
                  onSelect={(v) => (v === 'preset' ? setBackground({ type: 'preset' }) : pickBg(v))}
                  labels={{ preset: t('studio.bgPreset'), image: t('studio.bgImage'), video: t('studio.bgVideo') }}
                />
              )
            }
          />
          {hasMedia && (
            <Row title={t('studio.bgChange')} onPress={() => pickBg(bg.type as 'image' | 'video')} right={<Ionicons name="images-outline" size={18} color={textSecondary} />} />
          )}
          {hasMedia && (
            <View style={[styles.block, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: border }]}>
              <View style={[styles.sliderHead, { marginTop: 0 }]}>
                <Text style={[styles.label, { color: text }]}>{t('studio.dim')}</Text>
                <Text style={{ color: textSecondary, fontSize: 13 }}>{Math.round((bg.dim / 0.8) * 100)}%</Text>
              </View>
              <Slider value={bg.dim / 0.8} thickness={6} fill={accent} track={border} onChange={dimS.change} onCommit={dimS.commit} />
            </View>
          )}
        </Group>
        </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800' },
  section: { fontSize: 18, fontWeight: '800', marginTop: 26, marginBottom: 6 },
  systemBadge: {
    position: 'absolute', left: '50%', top: '42%', marginLeft: -14, width: 28, height: 28, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center',
  },
  sliderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 },
  label: { fontSize: 15, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  block: { paddingHorizontal: 16, paddingVertical: 14 },
});

// Ô chọn dải màu khói: chấm tròn tô chuyển màu của dải (Theo ảnh bìa: ba màu mẫu), vòng màu nhấn hiện / tắt êm khi chọn
const rgbHex = (c: number[]) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
function ToneChip({ tone, label, on, ring, text, dim, onPress }: { tone: SmokeTone; label: string; on: boolean; ring: string; text: string; dim: string; onPress: () => void }) {
  const colors: [string, string, string] =
    tone === 'cover' ? ['#E2574C', '#F2B134', '#3E8EDE'] : [rgbHex(SMOKE_COLORS[tone].c[3]), rgbHex(SMOKE_COLORS[tone].c[1]), rgbHex(SMOKE_COLORS[tone].c[2])];
  const ringStyle = useAnimatedStyle(() => ({
    opacity: withTiming(on ? 1 : 0, { duration: 180 }),
    transform: [{ scale: withTiming(on ? 1 : 0.86, { duration: 220 }) }],
  }));
  return (
    <Pressable onPress={onPress} hitSlop={4} style={({ pressed }) => ({ width: 58, alignItems: 'center', transform: [{ scale: pressed ? 0.94 : 1 }] })}>
      <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 24, borderWidth: 2, borderColor: ring }, ringStyle]} />
        <LinearGradient colors={colors} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={{ width: 38, height: 38, borderRadius: 19 }} />
      </View>
      <Text numberOfLines={1} style={{ color: on ? text : dim, fontSize: 11, fontWeight: on ? '700' : '500', marginTop: 4 }}>
        {label}
      </Text>
    </Pressable>
  );
}

// Default / Pop switch at the top of Theme Studio
function KindSwitch() {
  const { theme, setStyle } = useTheme();
  const t = useT();
  const pop = theme.style === 'pop';
  const { accent, onAccent, text, textSecondary, border } = theme.colors;
  const item = (kind: 'glass' | 'pop', label: string) => {
    const on = theme.style === kind;
    return (
      <Pressable
        key={kind}
        onPress={() => setStyle(kind)}
        style={[
          { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderCurve: 'continuous' },
          on && { backgroundColor: accent },
          on && pop && { borderWidth: 2, borderColor: border },
        ]}
      >
        <Text style={{ color: on ? onAccent : text, fontWeight: '900', fontSize: 15 }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <>
      <View style={[{ flexDirection: 'row', gap: 5, padding: 5, marginTop: 18, borderRadius: 16, borderCurve: 'continuous' }, glassShadow(0.8, theme.colors.glassTint !== 'dark')]}>
        <GlassFill radius={16} solid={0.5} slab />
        {item('glass', t('studio.kind.default'))}
        {item('pop', t('studio.kind.pop'))}
      </View>
      <Text style={{ color: textSecondary, fontSize: 13, marginTop: 8, marginHorizontal: 2, lineHeight: 18 }}>
        {t(pop ? 'studio.kindHint.pop' : 'studio.kindHint.default')}
      </Text>
    </>
  );
}

// Pop side of Theme Studio: 8 Pop themes + look options (outline, shadow, shadow colour, background pattern, follow phone)
function PopPane() {
  const { theme, setPop } = useTheme();
  const t = useT();
  const scheme = useColorScheme();
  const { width } = useScreenSize();
  const p = theme.pop;
  const cols = 4;
  const tile = Math.floor((Math.min(width, 520) - PAD * 2 - 10 * (cols - 1)) / cols);
  const pick = (id: PopThemeId) => setPop({ theme: id, followSystem: false });
  return (
    <>
      <Text style={[styles.section, { color: theme.colors.text }]}>{t('studio.popThemes')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
        {POP_THEME_ORDER.map((id) => {
          const c = POP_THEMES[id];
          const on = p.theme === id;
          return (
            <Pressable key={id} onPress={() => pick(id)} style={{ width: tile, alignItems: 'center' }}>
              <View
                style={[
                  { width: tile, height: tile, borderRadius: 14, borderCurve: 'continuous', backgroundColor: c.bg, borderWidth: 2.5, borderColor: '#111111', overflow: 'hidden' },
                  on && { outlineWidth: 3, outlineColor: theme.colors.text, outlineOffset: 2 },
                ]}
              >
                <View style={{ position: 'absolute', right: '12%', top: '12%', width: '26%', aspectRatio: 1, borderRadius: 99, backgroundColor: c.accent, borderWidth: 2, borderColor: '#111111' }} />
                <View style={{ position: 'absolute', left: '18%', right: '18%', bottom: '16%', height: '28%', borderRadius: 6, backgroundColor: c.surface, borderWidth: 2, borderColor: '#111111' }} />
              </View>
              <Text numberOfLines={1} style={{ color: theme.colors.text, fontSize: 12, fontWeight: '800', marginTop: 6 }}>{POP_THEME_NAMES[id]}</Text>
            </Pressable>
          );
        })}
      </View>

      <Group label={t('studio.popLook')} color={GROUP_COLORS.yellow} style={{ marginTop: 34 }}>
        <Row
          first
          title={t('studio.pop.line')}
          right={<Seg options={POP_LINES} value={p.line} onSelect={(line) => setPop({ line })} labels={{ thin: t('studio.pop.line.thin'), bold: t('studio.pop.line.bold'), chunky: t('studio.pop.line.chunky') }} />}
        />
        <Row
          title={t('studio.pop.shadow')}
          right={<Seg options={POP_SHADOWS} value={p.shadow} onSelect={(shadow) => setPop({ shadow })} labels={{ none: t('studio.pop.shadow.none'), short: t('studio.pop.shadow.short'), long: t('studio.pop.shadow.long') }} />}
        />
        <Row
          title={t('studio.pop.shadowColor')}
          right={<Seg options={POP_SHADOW_COLORS} value={p.shadowColor} onSelect={(shadowColor) => setPop({ shadowColor })} labels={{ ink: t('studio.pop.shadowColor.ink'), accent: t('studio.pop.shadowColor.accent') }} />}
        />
        <Row
          title={t('studio.pop.pattern')}
          right={<Seg options={POP_PATTERNS} value={p.pattern} onSelect={(pattern) => setPop({ pattern })} labels={{ plain: t('studio.pop.pattern.plain'), dots: t('studio.pop.pattern.dots'), grid: t('studio.pop.pattern.grid') }} />}
        />
        <Row
          title={t('studio.pop.follow')}
          hint={t('studio.pop.followHint')}
          right={<Toggle value={p.followSystem} onChange={(v) => setPop(v ? { followSystem: true, theme: popSystemTheme(scheme) } : { followSystem: false })} />}
        />
      </Group>
    </>
  );
}
