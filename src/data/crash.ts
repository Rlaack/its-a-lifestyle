import { Alert, Platform } from 'react-native';
import Constants from 'expo-constants';
import Crypto from '../../modules/lifestyle-crypto';
import { RELAY_URL } from './secure/client';

// Private crash reports. When the app hits an error it can't recover from, a short report (the error,
// where in the app's code it happened, the app and iOS versions) is kept in the encrypted vault. On the
// next start the person is asked whether to send it. Nothing else goes with it: no account ID, no
// names, no messages. No third-party crash service is involved. JavaScript errors only; a crash inside
// native code isn't caught.

const VAULT = 'crash-v1';
type Report = { v: 1; at: number; message: string; stack: string; app: string; os: string };

const clean = (s: string, max: number) => s
  .replace(/https?:\/\/\S+/g, '[url]')            // bundle URLs, nothing personal but noisy
  .replace(/\/(Users|var|private)\/[^\s:)]+/g, '[path]')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]') // account IDs
  .replace(/\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}\b/g, '[code]') // invite codes
  .slice(0, max);

function build(e: unknown): Report {
  const err = e instanceof Error ? e : new Error(String(e));
  return {
    v: 1, at: Date.now(),
    message: clean(`${err.name}: ${err.message}`, 300),
    stack: clean((err.stack ?? '').split('\n').slice(0, 15).join('\n'), 3000),
    app: `${Constants.expoConfig?.version ?? '?'} (${Constants.expoConfig?.ios?.buildNumber ?? '?'})`,
    os: `${Platform.OS} ${Platform.Version}`,
  };
}

/** Catches fatal JavaScript errors and keeps a report for the next start. Development builds keep
 *  the usual red error screen and don't save anything. */
export function installCrashCatcher() {
  if (__DEV__ || !Crypto) return;
  const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } };
  const eu = g.ErrorUtils;
  if (!eu) return;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((e, fatal) => {
    if (fatal) Crypto!.vaultWrite(VAULT, JSON.stringify(build(e))).catch(() => {});
    prev(e, fatal);
  });
}

/** On start: if the app crashed last time, ask before sending the report. */
export async function offerCrashReport() {
  if (!Crypto) return;
  let report: Report | null = null;
  try { const raw = await Crypto.vaultRead(VAULT); report = raw ? JSON.parse(raw) : null; } catch { return; }
  if (!report) return;
  const forget = () => Crypto!.vaultWrite(VAULT, '').catch(() => {});
  Alert.alert('It’s a Lifestyle closed unexpectedly',
    `Send a crash report to help fix it? It contains only the error and the app and iOS versions: no account, names or messages.\n\n${report.message}`,
    [{ text: 'Don’t send', style: 'cancel', onPress: forget },
     { text: 'Send', onPress: () => { fetch(`${RELAY_URL}/v1/crash`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) }).catch(() => {}).finally(forget); } }]);
}
