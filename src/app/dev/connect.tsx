import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { connectWithCode, createHoodOnline, joinHoodOnline, myConnectCode, setMyName, useSecureStatus } from '@/data/secure/sync';
import { actions } from '@/data/store';

// DEVELOPER ONLY: simulators have no camera, so this stands in for scanning a code. It calls the
// same connectWithCode() the scanner uses. Unavailable in release builds; linked from nowhere.
//   itsalifestyle://dev/connect?name=Alice        set my name, print my connect code to the dev log
//   itsalifestyle://dev/connect?code=<code>       "scan" a neighbor's code and open the chat
export default function DevConnect() {
  const { name, code, hood, join } = useLocalSearchParams<{ name?: string; code?: string; hood?: string; join?: string }>();
  const status = useSecureStatus();
  const [out, setOut] = useState('…');
  useEffect(() => {
    if (!__DEV__ || status !== 'ready') return;
    (async () => {
      if (name) setMyName(name);
      // Same functions the Start and Join screens use; the dev log carries the invite code between simulators.
      if (hood) {
        const c = await createHoodOnline(hood);
        actions.createHood({ name: hood, about: '', places: [], inviters: 'everyone', remoteCode: c });
        console.log(`[dev-connect] HOOD_CODE ${c}`);
        return setOut(`Created ${hood}: ${c}`);
      }
      if (join) { const n = await joinHoodOnline(join); return setOut(n ? `Joined ${n}` : 'Join failed'); }
      if (code) {
        const r = await connectWithCode(code);
        console.log(`[dev-connect] ${JSON.stringify(r)}`);
        if (r.ok) router.replace(`/chat/${r.chatId}`); else setOut(r.reason);
        return;
      }
      const mine = await myConnectCode();
      console.log(`[dev-connect] CONNECT_CODE ${mine}`);
      setOut(mine ?? 'Set a name first (?name=)');
    })();
  }, [status, name, code, hood, join]);
  if (!__DEV__) return <Redirect href="/" />;
  return <View style={{ flex: 1, padding: 24, paddingTop: 80 }}><Text selectable>{status}: {out}</Text></View>;
}
