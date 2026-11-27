import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { POP_ACCENTS, popMode } from '../theme/pop';
import { GlassFill, glassShadow } from './Glass';

// Building blocks for grouped settings pages (Settings, Dock, Theme Studio), from the approved 27/11 mockup:
// a group = a label + one card holding rows; each row = title (+ hint) on the left, a control on the right.
// Pop draws the label as a coloured tag sitting on the card's top edge; Glass shows it as small text above the card.

export const GROUP_COLORS = POP_ACCENTS;

export function Group({ label, color, children, style }: { label: string; color: string; children: React.ReactNode; style?: object }) {
  const { theme } = useTheme();
  const pop = theme.style === 'pop';
  const gs = glassShadow(0.8, theme.colors.glassTint !== 'dark');
  return (
    <View style={[{ marginTop: pop ? 30 : 26 }, style]}>
      {pop ? (
        <View style={[styles.tag, { backgroundColor: color, borderColor: '#111111', borderWidth: Math.min(popMode.line, 2.5) }]}>
          <Text style={styles.tagText}>{label}</Text>
        </View>
      ) : (
        <Text style={[styles.glassLabel, { color: theme.colors.textSecondary }]}>{label}</Text>
      )}
      <View style={[styles.card, gs]}>
        <GlassFill radius={18} solid={0.5} slab />
        <View style={{ paddingTop: pop ? 8 : 0 }}>{children}</View>
      </View>
    </View>
  );
}

export function Row({
  title,
  hint,
  right,
  left,
  onPress,
  first,
  danger,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  left?: React.ReactNode;
  onPress?: () => void;
  first?: boolean;
  danger?: boolean;
}) {
  const { theme } = useTheme();
  const pop = theme.style === 'pop';
  const body = (
    <>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? '#E5484D' : theme.colors.text, fontSize: 15.5, fontWeight: '700' }}>{title}</Text>
        {!!hint && <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 17 }}>{hint}</Text>}
      </View>
      {right}
    </>
  );
  const sep = first
    ? null
    : pop
    ? { borderTopWidth: 1.5, borderStyle: 'dashed' as const, borderTopColor: `${theme.colors.border}44` }
    : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border };
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, sep, pressed && { opacity: 0.6 }]}>
      {body}
    </Pressable>
  ) : (
    <View style={[styles.row, sep]}>{body}</View>
  );
}

export function Chevron({ value }: { value?: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '50%' }}>
      {!!value && (
        <Text numberOfLines={1} style={{ color: theme.colors.textSecondary, fontWeight: '700', fontSize: 13.5, flexShrink: 1 }}>
          {value}
        </Text>
      )}
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
    </View>
  );
}

// Segmented choice (2–4 short options)
export function Seg<T extends string>({ options, value, onSelect, labels }: { options: readonly T[]; value: T; onSelect: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  const { theme } = useTheme();
  const pop = theme.style === 'pop';
  const { accent, onAccent, text, border } = theme.colors;
  const line = pop ? Math.min(popMode.line, 2.5) : StyleSheet.hairlineWidth;
  return (
    <View style={[styles.seg, { borderWidth: line, borderColor: pop ? border : theme.colors.border, borderRadius: pop ? 11 : 16 }]}>
      {options.map((o, i) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => onSelect(o)}
            hitSlop={{ top: 8, bottom: 8 }}
            style={[styles.segItem, on && { backgroundColor: accent }, i > 0 && { borderLeftWidth: line, borderLeftColor: pop ? border : theme.colors.border }]}
          >
            <Text style={{ color: on ? onAccent : text, fontWeight: '800', fontSize: 13 }}>{labels?.[o] ?? o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { theme } = useTheme();
  const pop = theme.style === 'pop';
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: pop ? POP_ACCENTS.mint : theme.colors.accent, false: theme.colors.switchOff }}
      thumbColor={pop ? '#111111' : undefined}
      ios_backgroundColor={theme.colors.switchOff}
    />
  );
}

const styles = StyleSheet.create({
  tag: { position: 'absolute', top: -13, left: 12, zIndex: 2, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 2 },
  tagText: { color: '#111111', fontWeight: '900', fontSize: 13 },
  glassLabel: { fontSize: 13, fontWeight: '700', marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 18, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, minHeight: 52 },
  seg: { flexDirection: 'row', overflow: 'hidden' },
  segItem: { paddingHorizontal: 11, paddingVertical: 6 },
});

// Back button + big title for pages opened from Settings (Theme Studio, Dock)
export function PageHeader({ title }: { title: string }) {
  const { theme } = useTheme();
  const { useNav } = require('../nav/Nav') as typeof import('../nav/Nav');
  const { useAnimatedBack } = require('../nav/SwipeBack') as typeof import('../nav/SwipeBack');
  const { useDisplayFont } = require('../theme/fonts') as typeof import('../theme/fonts');
  const { pop: popPage } = useNav();
  const goBack = useAnimatedBack() ?? popPage;
  const df = useDisplayFont();
  const pop = theme.style === 'pop';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Pressable
        onPress={goBack}
        hitSlop={10}
        style={[
          { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: pop ? 12 : 21, borderCurve: 'continuous' },
          pop ? glassShadow(0.75) : { backgroundColor: theme.colors.surface },
        ]}
      >
        {pop && <GlassFill radius={12} />}
        <Ionicons name="chevron-back" size={24} color={theme.colors.text} />
      </Pressable>
      <Text numberOfLines={1} style={[{ flex: 1, color: theme.colors.text, fontSize: 28, fontWeight: '800' }, df]}>{title}</Text>
    </View>
  );
}
