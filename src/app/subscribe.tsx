import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Button, IconButton, Notice, Screen, T } from '@/components/ui';
import { toast } from '@/components/Toast';
import { buyPlan, loadOffer, MANAGE_SUBSCRIPTION_URL, restorePlan, type StoreOffer } from '@/data/billing';
import { billingStatus, type BillingStatus } from '@/data/secure/client';
import { PRIVACY_URL } from '@/data/security';

const EULA = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

// The neighborhood owner plan. Joining a neighborhood is always free.
export default function Subscribe() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [offer, setOffer] = useState<StoreOffer | null>(null);
  const [offerFailed, setOfferFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    billingStatus().then(setStatus).catch(() => toast('Couldn’t reach the server.'));
    loadOffer().then(o => { setOffer(o); setOfferFailed(!o); }).catch(() => setOfferFailed(true));
  }, []);
  const buy = async () => {
    setBusy(true);
    try { if (await buyPlan()) { toast('You’re subscribed. Thanks for hosting your neighborhood.'); router.back(); } }
    catch (e) { toast(e instanceof Error && !/relay/.test(e.message) ? e.message : 'Your purchase couldn’t be confirmed. Try Restore Purchases.'); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    setBusy(true);
    try {
      const s = await restorePlan(); setStatus(s);
      toast(s.active ? 'Your subscription is restored.' : 'No active subscription found.');
      if (s.active) router.back();
    } catch { toast('Couldn’t restore. Check your connection.'); }
    finally { setBusy(false); }
  };
  const active = !!status?.active;
  return (
    <Screen sheet title="Neighborhood plan" right={<IconButton name="x" label="Close" onPress={() => router.back()} />}>
      <T variant="muted">Own and run your neighborhood. Your neighbors always join free.</T>
      <Notice icon="shield" title="What’s included">Up to {status?.limit ?? 3} neighborhoods with owner controls, invite codes, plans, calendars and chats for everyone you invite.</Notice>
      {active ? <>
        <T variant="strong">Active · renews or ends {new Date(status!.expires).toLocaleDateString()}</T>
        <T variant="muted">Using {status!.used} of {status!.limit} neighborhoods.</T>
        <Button label="Manage or cancel in the App Store" onPress={() => Linking.openURL(MANAGE_SUBSCRIPTION_URL)} />
      </> : <>
        {offer && <T variant="strong">{offer.trial ? `1 month free, then ${offer.price} a year` : `${offer.price} a year`}</T>}
        {offerFailed && <T variant="muted">The subscription isn’t available right now. Try again later.</T>}
        {offer && <Button kind="primary" label={busy ? 'Working…' : offer.trial ? 'Start free trial' : 'Subscribe'} onPress={busy ? () => {} : buy} />}
        {offer && <T variant="small">Renews automatically each year at {offer.price} unless canceled at least 24 hours before the period ends. Your Apple account is charged{offer.trial ? ' when the trial ends' : ' when you confirm'}. Manage or cancel anytime in your App Store account settings.</T>}
      </>}
      <Button label="Restore Purchases" onPress={busy ? () => {} : restore} />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20 }}>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(EULA)}><T variant="small">Terms of Use</T></Pressable>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(PRIVACY_URL)}><T variant="small">Privacy Policy</T></Pressable>
      </View>
    </Screen>
  );
}
