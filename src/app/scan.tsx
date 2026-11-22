import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { toast } from '@/components/Toast';
import { Button, IconButton, Screen, T } from '@/components/ui';
import { connectWithCode, isLinkCode, isTransferCode } from '@/data/secure/sync';

// Scan a neighbor's connect code. Connects you and pins their encryption key (verified in person).
export default function Scan() {
  const [perm, request] = useCameraPermissions();
  const done = useRef(false);
  const onScan = async ({ data }: { data: string }) => {
    if (done.current) return;
    done.current = true;
    if (isTransferCode(data)) return router.replace(`/transfer?code=${encodeURIComponent(data)}`);
    if (isLinkCode(data)) return router.replace(`/devices?code=${encodeURIComponent(data)}`);
    if (!data.startsWith('itsalifestyle:')) { router.back(); return toast('That code isn’t from It’s a Lifestyle.'); }
    const r = await connectWithCode(data);
    if (!r.ok) { router.back(); return toast(r.reason); }
    router.replace(`/chat/${r.chatId}`);
    toast(`Connected with ${r.name}. You’re verified in person.`);
  };
  return (
    <Screen sheet title="Scan a code" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      {!perm ? null : !perm.granted ? <>
        <T>Scanning needs the camera. It’s only used while this screen is open.</T>
        <Button kind="primary" label="Allow camera" onPress={request} />
      </> : (
        <View style={styles.frame}>
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
        </View>
      )}
      <T variant="muted">Point the camera at your neighbor’s code on their phone.</T>
    </Screen>
  );
}

const styles = StyleSheet.create({
  frame: { height: 360, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000' },
});
