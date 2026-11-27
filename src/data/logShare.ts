// Settings › Log: copy / send one day's log, or email it straight to the developer (Supabase Edge Function "send-log",
// which mails it to the developer through Resend). Logs are scrubbed of IP addresses and stream tokens first.
import { Platform, Share } from 'react-native';
import { kvGet, kvSet } from './db';
import { getDayLines, logToText, type DayMeta, type LogLine } from './applog';
import { scrubLog } from './blackbox';

export interface DeviceInfo { model: string; os: string; appVersion: string; updateId: string }

let infoP: Promise<DeviceInfo> | null = null;
export function deviceInfo(): Promise<DeviceInfo> {
  if (infoP) return infoP;
  infoP = (async () => {
    let model = '';
    let appVersion = '';
    try {
      // Sentry's native side already knows the device model and the installed app version (internal API, guarded)
      const { NATIVE } = require('@sentry/react-native/dist/js/wrapper');
      const ctx = await NATIVE.fetchNativeDeviceContexts();
      const dev = ctx?.contexts?.device ?? {};
      model = [dev.manufacturer, dev.model].filter(Boolean).join(' ') || dev.family || '';
      appVersion = (await NATIVE.fetchNativeRelease())?.version ?? '';
    } catch {}
    if (!model && Platform.OS === 'android') {
      const c = Platform.constants as { Brand?: string; Model?: string };
      model = [c.Brand, c.Model].filter(Boolean).join(' ');
    }
    let updateId = '';
    try {
      updateId = (require('expo-updates') as typeof import('expo-updates')).updateId ?? 'embedded';
    } catch {}
    return { model: model || 'unknown device', os: `${Platform.OS} ${Platform.Version}`, appVersion, updateId };
  })();
  return infoP;
}

export function deviceId(): string {
  let id = kvGet<string>('zyx.deviceId');
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    kvSet('zyx.deviceId', id);
  }
  return id;
}

export async function dayText(day: string, lines?: LogLine[]): Promise<string> {
  const info = await deviceInfo();
  const body = logToText(lines ?? getDayLines(day));
  const head = `ZYX log · ${day}\nDevice: ${info.model} · ${info.os} · ZYX ${info.appVersion} · update ${info.updateId.slice(0, 8)}\n\n`;
  return scrubLog(head + body);
}

// Copy: the system share sheet (it has "Copy")
export async function copyDay(day: string, lines?: LogLine[]) {
  await Share.share({ message: await dayText(day, lines) }).catch(() => {});
}

// Send as a .txt file (iOS shares the file; Android's share sheet only takes text, so it sends the text)
export async function sendDayFile(day: string, lines?: LogLine[]) {
  const text = await dayText(day, lines);
  if (Platform.OS !== 'ios') return void Share.share({ message: text }).catch(() => {});
  try {
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const f = new File(Paths.cache, `zyx-log-${day}.txt`);
    if (f.exists) f.delete();
    f.create();
    f.write(text);
    await Share.share({ url: f.uri });
  } catch {
    await Share.share({ message: text }).catch(() => {});
  }
}

export type SendResult = 'ok' | 'limit' | 'offline' | 'failed';

// Email the day's full log to the developer
export async function sendDayToDeveloper(meta: DayMeta): Promise<SendResult> {
  try {
    const info = await deviceInfo();
    const { supabase } = require('../backend/supabase') as typeof import('../backend/supabase');
    const { error } = await supabase.functions.invoke('send-log', {
      body: {
        device_id: deviceId(),
        day: meta.day,
        model: info.model,
        platform: Platform.OS,
        os: String(Platform.Version),
        app_version: info.appVersion,
        update_id: info.updateId,
        crashes: meta.crashes,
        errors: meta.errors,
        log: await dayText(meta.day),
      },
    });
    if (!error) return 'ok';
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 429) return 'limit';
    if (String(error.message ?? '').toLowerCase().includes('fetch')) return 'offline';
    return 'failed';
  } catch {
    return 'offline';
  }
}
