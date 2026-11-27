// Admin dashboard (27/11) — only reachable from Settings by the admin account (Supabase table "admins"; the server
// refuses everyone else, the app just hides the entry). Every device that has "Send diagnostics" on appears here:
// model, OS, app version, a health colour for the last 7 days; open one to see its days and ask for a day's log.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';
import { useContentInsets } from '../components/FloatingDock';
import { useNav } from '../nav/Nav';
import { Group, GROUP_COLORS, PageHeader, Row } from '../components/SettingsUI';
import { popEdge, popMode } from '../theme/pop';
import { useSession } from '../data/auth';
import { previewWelcome } from './AuthGate';

const sb = () => (require('../backend/supabase') as typeof import('../backend/supabase')).supabase;

type Device = { device_id: string; model: string; os: string; app_version: string; channel: string; update_id: string; first_seen: string; last_seen: string };
type Health = {
  device_id: string; day: string; sessions: number; crashes: number; errors: number; freezes: number; janks: number;
  memory_warnings: number; startup_ms: number | null; peak_js_mb: number | null; log_lines: number;
};
type Status = 'red' | 'yellow' | 'green';
const DOT: Record<Status, string> = { red: '#E5484D', yellow: '#F5B700', green: '#30A46C' };

// red = crashed or killed in the last 7 days; yellow = froze (≥ 1 s), memory warning or errors; green = clean
function statusOf(days: Health[]): Status {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const recent = days.filter((d) => d.day >= since);
  if (recent.some((d) => d.crashes > 0)) return 'red';
  if (recent.some((d) => d.freezes > 0 || d.memory_warnings > 0 || d.errors > 0)) return 'yellow';
  return 'green';
}
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

// Is the signed-in account an admin? (asked once per app run)
let adminCache: { id: string; v: boolean } | null = null;
export function useIsAdmin() {
  const session = useSession();
  const id = session?.mode === 'account' ? session.id ?? '' : '';
  const [v, setV] = useState(adminCache && adminCache.id === id ? adminCache.v : false);
  useEffect(() => {
    if (!id) return setV(false);
    if (adminCache?.id === id) return setV(adminCache.v);
    let alive = true;
    sb()
      .rpc('is_admin')
      .then(({ data }) => {
        adminCache = { id, v: data === true };
        if (alive) setV(data === true);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return v;
}

function Dot({ s }: { s: Status }) {
  return <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: DOT[s], borderWidth: popMode.on ? 1.5 : 0, borderColor: '#111111' }} />;
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: on ? theme.colors.accent : theme.colors.surface }, popEdge(true)]}>
      <Text style={{ color: on ? theme.colors.onAccent : theme.colors.text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function AdminScreen() {
  const { theme } = useTheme();
  const pad = useContentInsets();
  const { push } = useNav();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [health, setHealth] = useState<Health[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setErr(null);
    const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const [d, h] = await Promise.all([
      sb().from('devices').select('*').order('last_seen', { ascending: false }).limit(1000),
      sb().from('device_health').select('*').gte('day', since).limit(20000),
    ]);
    if (d.error || h.error) return setErr((d.error ?? h.error)!.message);
    setDevices(d.data as Device[]);
    setHealth(h.data as Health[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const byDevice = useMemo(() => {
    const m = new Map<string, Health[]>();
    for (const x of health) (m.get(x.device_id) ?? m.set(x.device_id, []).get(x.device_id)!).push(x);
    return m;
  }, [health]);
  const rows = useMemo(
    () =>
      (devices ?? []).map((d) => ({ d, s: statusOf(byDevice.get(d.device_id) ?? []) })).filter(
        (r) => (filter === 'all' || r.s === filter) && (!q.trim() || `${r.d.model} ${r.d.os} ${r.d.app_version}`.toLowerCase().includes(q.trim().toLowerCase()))
      ),
    [devices, byDevice, filter, q]
  );
  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, green: 0 };
    for (const d of devices ?? []) c[statusOf(byDevice.get(d.device_id) ?? [])]++;
    return c;
  }, [devices, byDevice]);
  const { text, textSecondary, surface } = theme.colors;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      contentContainerStyle={{ paddingTop: pad.top + 8, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: 16, width: '100%', maxWidth: 720, alignSelf: 'center' }}
    >
      <PageHeader title="Admin" />
      <Text style={{ color: textSecondary, marginTop: 8 }}>
        {devices ? `${devices.length} devices · ` : ''}last 7 days: {counts.red} red · {counts.yellow} yellow · {counts.green} green
      </Text>

      <View style={[styles.search, { backgroundColor: surface }, popEdge()]}>
        <Ionicons name="search" size={16} color={textSecondary} />
        <TextInput value={q} onChangeText={setQ} placeholder="Model, OS or version" placeholderTextColor={textSecondary} style={{ flex: 1, color: text, paddingVertical: 9 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {(['all', 'red', 'yellow', 'green'] as const).map((f) => (
          <Chip key={f} label={f === 'all' ? 'All' : `${f[0].toUpperCase()}${f.slice(1)} · ${counts[f]}`} on={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>

      <Group label="Tools" color={GROUP_COLORS.lilac}>
        <Row first title="Preview welcome screens" hint="Sign-in poster, genres, what's inside, look, drop the needle. Nothing is saved." onPress={previewWelcome} right={<Ionicons name="chevron-forward" size={18} color={textSecondary} />} />
      </Group>

      {err && <Text style={{ color: '#E5484D', marginTop: 16 }}>{err}</Text>}
      {!devices && !err && <ActivityIndicator style={{ marginTop: 30 }} color={theme.colors.accentText} />}
      {devices && (
        <Group label="Devices" color={GROUP_COLORS.sky}>
          {rows.length === 0 && <Row first title="No devices" />}
          {rows.map(({ d, s }, i) => (
            <Row
              key={d.device_id}
              first={i === 0}
              left={<Dot s={s} />}
              title={d.model || 'Unknown device'}
              hint={`${d.os} · ZYX ${d.app_version}${d.channel ? ` (${d.channel})` : ''} · seen ${ago(d.last_seen)} ago`}
              onPress={() => push({ type: 'adminDevice', id: d.device_id })}
              right={<Ionicons name="chevron-forward" size={18} color={textSecondary} />}
            />
          ))}
        </Group>
      )}
    </ScrollView>
  );
}

// One device: its days (health counts) — ask for a day's log, then open it once the phone has uploaded it
export function AdminDeviceScreen({ id }: { id: string }) {
  const { theme } = useTheme();
  const pad = useContentInsets();
  const [device, setDevice] = useState<Device | null>(null);
  const [days, setDays] = useState<Health[]>([]);
  const [requests, setRequests] = useState<Record<string, boolean>>({}); // day → fulfilled?
  const [logs, setLogs] = useState<Record<string, number>>({}); // day → bytes uploaded
  const [open, setOpen] = useState<{ day: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [d, h, r, l] = await Promise.all([
      sb().from('devices').select('*').eq('device_id', id).maybeSingle(),
      sb().from('device_health').select('*').eq('device_id', id).order('day', { ascending: false }).limit(30),
      sb().from('log_requests').select('day, fulfilled_at').eq('device_id', id),
      sb().from('device_logs').select('day, bytes').eq('device_id', id),
    ]);
    setDevice((d.data as Device) ?? null);
    setDays((h.data as Health[]) ?? []);
    setRequests(Object.fromEntries(((r.data as { day: string; fulfilled_at: string | null }[]) ?? []).map((x) => [x.day, !!x.fulfilled_at])));
    setLogs(Object.fromEntries(((l.data as { day: string; bytes: number }[]) ?? []).map((x) => [x.day, x.bytes])));
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const ask = async (day: string) => {
    setBusy(day);
    const { error } = await sb().from('log_requests').upsert({ device_id: id, day, fulfilled_at: null }, { onConflict: 'device_id,day' });
    setBusy(null);
    if (!error) setRequests((r) => ({ ...r, [day]: false }));
  };
  const view = async (day: string) => {
    setBusy(day);
    const { data } = await sb().from('device_logs').select('content').eq('device_id', id).eq('day', day).maybeSingle();
    setBusy(null);
    if (data) setOpen({ day, text: (data as { content: string }).content });
  };
  const { text, textSecondary } = theme.colors;

  if (open) {
    return (
      <View style={{ flex: 1, paddingTop: pad.top + 8, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable onPress={() => setOpen(null)} hitSlop={10}>
            <Ionicons name="chevron-back" size={26} color={text} />
          </Pressable>
          <Text style={{ flex: 1, color: text, fontSize: 18, fontWeight: '800' }}>Log {open.day}</Text>
          <Pressable onPress={() => Share.share({ message: open.text }).catch(() => {})} hitSlop={10}>
            <Ionicons name="share-outline" size={22} color={text} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ paddingBottom: pad.bottom + pad.endPadding }}>
          <Text selectable style={{ color: text, fontSize: 11, fontFamily: 'Menlo', lineHeight: 15 }}>
            {open.text}
          </Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      contentContainerStyle={{ paddingTop: pad.top + 8, paddingBottom: pad.bottom + pad.endPadding, paddingHorizontal: 16, width: '100%', maxWidth: 720, alignSelf: 'center' }}
    >
      <PageHeader title={device?.model || 'Device'} />
      {device && (
        <Text style={{ color: textSecondary, marginTop: 8, lineHeight: 20 }}>
          {device.os} · ZYX {device.app_version}
          {device.channel ? ` (${device.channel})` : ''} · update {device.update_id.slice(0, 8)}
          {'\n'}first seen {ago(device.first_seen)} ago · last seen {ago(device.last_seen)} ago
          {'\n'}id {device.device_id}
        </Text>
      )}
      <Group label="Days" color={GROUP_COLORS.yellow}>
        {days.length === 0 && <Row first title="No reports yet" />}
        {days.map((d, i) => {
          const s = statusOf([{ ...d, day: new Date().toISOString().slice(0, 10) }]);
          const req = requests[d.day];
          const has = logs[d.day] != null;
          return (
            <Row
              key={d.day}
              first={i === 0}
              left={<Dot s={s} />}
              title={d.day}
              hint={[
                `${d.sessions} opens`,
                d.crashes ? `${d.crashes} crash` : '',
                d.freezes ? `${d.freezes} freezes` : '',
                d.memory_warnings ? `${d.memory_warnings} low memory` : '',
                `${d.janks} jank`,
                d.startup_ms != null ? `start ${d.startup_ms}ms` : '',
                d.peak_js_mb != null ? `JS ${d.peak_js_mb}MB` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              right={
                busy === d.day ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : has ? (
                  <Pressable onPress={() => view(d.day)} style={[styles.btn, { backgroundColor: theme.colors.accent }, popEdge()]}>
                    <Text style={{ color: theme.colors.onAccent, fontWeight: '800', fontSize: 12 }}>View log</Text>
                  </Pressable>
                ) : req === false ? (
                  <Text style={{ color: textSecondary, fontSize: 12, fontWeight: '700', maxWidth: 90, textAlign: 'right' }}>Requested · next app open</Text>
                ) : (
                  <Pressable onPress={() => ask(d.day)} style={[styles.btn, { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }, popEdge()]}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 12 }}>Request log</Text>
                  </Pressable>
                )
              }
            />
          );
        })}
      </Group>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, marginTop: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14 },
  btn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
});
