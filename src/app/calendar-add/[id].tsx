import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { Button, IconButton, Notice, Screen, T } from '@/components/ui';
import { addToPhoneCalendar, calCopyOf, openInGoogleCalendar } from '@/data/calendarCopy';
import { actions, useStore } from '@/data/store';
import { fonts } from '@/theme/tokens';
import { useTheme } from '@/theme/theme';

const VIA = { phone: 'phone calendar', google: 'Google Calendar' } as const;

// Add one plan to your own phone or Google calendar. Ported from the prototype's calAddSheet.
export default function AddToCalendar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = useStore(s => s.plans.find(x => x.id === id));
  const { c } = useTheme();
  const [remember, setRemember] = useState(false);
  if (!p) return null;
  const copy = calCopyOf(p);
  const ios = Platform.OS === 'ios';

  const add = async (via: 'phone' | 'google') => {
    if (remember) actions.setCalPref(via);
    if (via === 'google') {
      await openInGoogleCalendar(copy);
      actions.setCalCopy(p.id, { via });
      router.back();
      toast('Opened in Google Calendar. If the time changes, we’ll remind you to update it.');
      return;
    }
    const ok = await addToPhoneCalendar(copy);
    if (!ok) return toast('Adding to your phone calendar works in the installed app, not in Expo Go. Try Google Calendar for now.');
    actions.setCalCopy(p.id, { via });
    router.back();
    toast('Added to your phone calendar. We’ll keep it updated if anything changes.');
  };

  return (
    <Screen sheet title="Add to your calendar" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      {p.calCopy ? <>
        <Notice icon="check" title={`In your ${VIA[p.calCopy.via]}`}>
          {p.calCopy.via === 'google' ? 'If the time or place changes, we’ll send you a notification to update it in Google Calendar.' : 'If the time or place changes, we’ll update it for you. If it’s canceled, we’ll remove it.'}
        </Notice>
        {p.calCopy.via === 'phone' && <Button label="Remove from my calendar" onPress={() => { actions.setCalCopy(p.id, null); router.back(); toast('Removed from your calendar'); }} />}
      </> : <>
        <View style={[styles.preview, { backgroundColor: c.card, borderColor: c.line }]}>
          <T variant="strong">{copy.title}</T>
          <View style={styles.line}><Icon name="clock" size={15} color={c.muted} /><T variant="muted" style={{ flex: 1 }}>{copy.when}</T></View>
          <View style={styles.line}><Icon name="pin" size={15} color={c.muted} /><T variant="muted" style={{ flex: 1 }}>{copy.where}</T></View>
        </View>
        <T variant="muted">This is everything that gets copied. Notes, guest lists and addresses stay in the app{p.type === 'surprise' ? ', and the title is hidden so the surprise stays safe' : ''}.</T>
        {ios ? <>
          <Option icon="cal" title="Phone calendar" sub="Apple Calendar, plus any Google or Outlook account added in Settings" primary onPress={() => add('phone')} />
          <Option icon="cal" title="Google Calendar app" sub="Opens Google Calendar with the event filled in" onPress={() => add('google')} />
        </> : <>
          <Option icon="cal" title="Add to calendar" sub="Opens your calendar app, usually Google Calendar, so you can pick the account" primary onPress={() => add('phone')} />
          <Option icon="cal" title="Google Calendar on the web" sub="If your calendar app isn’t set up" onPress={() => add('google')} />
        </>}
        <Pressable onPress={() => setRemember(!remember)} accessibilityRole="checkbox" accessibilityState={{ checked: remember }} style={styles.line}>
          <View style={[styles.box, { borderColor: remember ? c.pine : c.line, backgroundColor: remember ? c.pine : c.card }]}>{remember && <Icon name="check" size={14} color={c.onPine} />}</View>
          <T>Remember my choice</T>
        </Pressable>
        <Notice icon="lock" title="Stored outside the app">{ios ? 'Apple or Google' : 'Google or your calendar provider'} stores this copy, outside the app’s encryption.</Notice>
      </>}
    </Screen>
  );
}

function Option({ icon, title, sub, onPress, primary }: { icon: 'cal'; title: string; sub: string; onPress: () => void; primary?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.opt, { backgroundColor: primary ? c.pine : c.card, borderColor: primary ? c.pine : c.line, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.line}><Icon name={icon} size={18} color={primary ? c.onPine : c.ink} /><Text style={{ fontFamily: fonts.bodySemi, fontSize: 15, color: primary ? c.onPine : c.ink }}>{title}</Text></View>
      <Text style={{ fontFamily: fonts.body, fontSize: 12.5, color: primary ? c.onPine : c.muted }}>{sub}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  preview: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  opt: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 3 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
