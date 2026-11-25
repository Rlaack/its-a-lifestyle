import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Button, IconButton, Pick, Screen, Section, T, initials } from '@/components/ui';
import { toast } from '@/components/Toast';
import { getMyName, setMyPicture } from '@/data/secure/sync';
import { useStore } from '@/data/store';
import type { Pic } from '@/data/types';
import { fonts, toneColors, type Tone } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

const TONES: Tone[] = ['pine', 'ember', 'plum', 'sky'];
const EMOJI = ['🙂', '😎', '🤠', '🌲', '🌊', '🔥', '🏡', '🐕', '🐈', '🦌', '🐻', '🦆', '🎣', '🛶', '🚲', '☕', '🍺', '🌻', '⛺', '🎸'];

// Your picture: initials in a color, an emoji, or a photo. Neighbors see it wherever your initials show.
export default function PictureScreen() {
  const { c } = useTheme();
  const mine = useStore(s => s.pics.You);
  const [tone, setTone] = useState<Tone | undefined>(mine?.tone);
  const [emoji, setEmoji] = useState<string | undefined>(mine?.emoji);
  const [photo, setPhoto] = useState<string | undefined>(mine?.uri);
  const [busy, setBusy] = useState(false);
  const changedPhoto = photo !== mine?.uri;

  const pick = async (camera: boolean) => {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6, exif: false };
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return toast('Camera access is off. Turn it on in Settings to take a photo.');
    }
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!r.canceled && r.assets?.[0]) setPhoto(r.assets[0].uri);
  };

  const save = async () => {
    setBusy(true);
    try {
      // Keeping the photo already shared: send it again as it is, without uploading it again.
      await setMyPicture(tone || emoji || photo
        ? { ...(tone ? { tone } : {}), ...(emoji && !photo ? { emoji } : {}), ...(photo && changedPhoto ? { photoUri: photo } : {}), ...(photo && !changedPhoto ? { keepPhoto: true } : {}) }
        : null);
      toast('Saved. Neighbors will see your new picture.');
      router.back();
    } catch {
      toast('Couldn’t save your picture. Check your connection and try again.');
    } finally { setBusy(false); }
  };

  const preview: Pic = { ...(tone ? { tone } : {}), ...(emoji && !photo ? { emoji } : {}), ...(photo ? { uri: photo } : {}) };
  const [fg, bg] = toneColors(c, tone ?? 'pine');
  return (
    <Screen sheet title="Your picture" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Preview pic={preview} name={getMyName() ?? 'You'} size={112} fg={fg} bg={bg} />
        <T variant="muted" style={{ textAlign: 'center' }}>People in your neighborhoods and group chats see this.</T>
      </View>

      <Section title="Photo">
        <View style={styles.row}>
          <View style={{ flex: 1 }}><Button label="Choose a photo" onPress={() => pick(false)} /></View>
          <View style={{ flex: 1 }}><Button label="Take a photo" onPress={() => pick(true)} /></View>
        </View>
        {!!photo && <Button label="Remove the photo" onPress={() => setPhoto(undefined)} />}
        <T variant="muted">Your photo is encrypted on this phone before it’s uploaded. The location and other hidden details are removed first.</T>
      </Section>

      {!photo && <>
        <Section title="Color">
          <View style={styles.row}>
            {TONES.map(t => {
              const [f, b] = toneColors(c, t);
              const on = (tone ?? null) === t;
              return (
                <Pressable key={t} onPress={() => setTone(on ? undefined : t)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${t} color`}
                  style={[styles.swatch, { backgroundColor: b, borderColor: on ? f : c.line, borderWidth: on ? 3 : 1 }]}>
                  <Text style={{ fontFamily: fonts.bodyBold, color: f }}>{initials(getMyName() ?? 'You')}</Text>
                </Pressable>
              );
            })}
          </View>
        </Section>
        <Section title="Emoji (optional)">
          <View style={styles.wrap}>
            {EMOJI.map(e => <Pick key={e} label={e} on={emoji === e} onPress={() => setEmoji(emoji === e ? undefined : e)} />)}
          </View>
          {!!emoji && <Button label="Use my initials instead" onPress={() => setEmoji(undefined)} />}
        </Section>
      </>}

      <Button kind="primary" label={busy ? 'Saving…' : 'Save'} onPress={busy ? () => {} : save} />
      {(mine || tone || emoji || photo) && <Button label="Back to plain initials" onPress={() => { setTone(undefined); setEmoji(undefined); setPhoto(undefined); }} />}
    </Screen>
  );
}

function Preview({ pic, name, size, fg, bg }: { pic: Pic; name: string; size: number; fg: string; bg: string }) {
  if (pic.uri) return <Image source={{ uri: pic.uri }} accessibilityLabel="Your picture" style={{ width: size, height: size, borderRadius: size / 2 }} />;
  if (pic.emoji) return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: size * 0.52 }}>{pic.emoji}</Text></View>;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: fonts.bodyBold, fontSize: size * 0.36, color: fg }}>{name === 'You' ? 'ME' : initials(name)}</Text></View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
