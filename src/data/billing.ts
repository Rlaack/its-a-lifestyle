import { useEffect, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { billingStatus, submitApplePurchase, type BillingStatus, type HoodPlan } from '@/data/secure/client';

export const PLAN_PRODUCT = 'com.itsalifestyle.app.neighborhood.annual';
export const MANAGE_SUBSCRIPTION_URL = 'https://apps.apple.com/account/subscriptions';

/* What the relay last said about each neighborhood's plan (keyed by store id, `r-<code>`). */
let plans: Record<string, HoodPlan> = {};
const listeners = new Set<() => void>();
export function setHoodPlan(hoodId: string, plan: HoodPlan | undefined) {
  if (!plan || JSON.stringify(plans[hoodId]) === JSON.stringify(plan)) return;
  plans = { ...plans, [hoodId]: plan };
  listeners.forEach(l => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useHoodPlan = (hoodId: string): HoodPlan | undefined => useSyncExternalStore(subscribe, () => plans[hoodId]);

/** Whether the relay is charging yet. Until it is, the app doesn't mention a plan at all. */
export function useBillingOn() {
  const [on, setOn] = useState(false);
  useEffect(() => { billingStatus().then(s => setOn(s.on)).catch(() => {}); }, []);
  return on;
}

export type StoreOffer = { price: string; trial: boolean };

async function iap() {
  if (Platform.OS !== 'ios') throw new Error('Subscriptions aren’t available on this device yet.');
  const m = await import('expo-iap');
  await m.initConnection();
  return m;
}

/** The price and free trial exactly as the App Store reports them for this person. */
export async function loadOffer(): Promise<StoreOffer | null> {
  // Store screenshots: simulators can't load the real product. Never set in a release build.
  if (__DEV__ && process.env.EXPO_PUBLIC_SCREENSHOTS === '1') return { price: '$29.99', trial: true };
  const m = await iap();
  const list = await m.fetchProducts({ skus: [PLAN_PRODUCT], type: 'subs' });
  const p = (list ?? [])[0] as { displayPrice?: string; introductoryPricePaymentModeIOS?: string } | undefined;
  if (!p?.displayPrice) return null;
  return { price: p.displayPrice, trial: String(p.introductoryPricePaymentModeIOS ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'freetrial' };
}

/** Opens Apple's purchase sheet. Resolves true once the relay has verified the purchase. */
export async function buyPlan(): Promise<boolean> {
  const m = await iap();
  await m.fetchProducts({ skus: [PLAN_PRODUCT], type: 'subs' });
  return new Promise<boolean>((resolve, reject) => {
    const done = (f: () => void) => { ok.remove(); bad.remove(); f(); };
    const ok = m.purchaseUpdatedListener(async purchase => {
      if (purchase.productId !== PLAN_PRODUCT || !purchase.purchaseToken) return;
      try {
        const s = await submitApplePurchase(purchase.purchaseToken);
        // Finish only after the relay has it, so an interrupted purchase is delivered again.
        await m.finishTransaction({ purchase, isConsumable: false });
        done(() => resolve(s.active));
      } catch (e) { done(() => reject(e)); }
    });
    const bad = m.purchaseErrorListener(e => done(() => (e.code === m.ErrorCode.UserCancelled ? resolve(false) : reject(new Error('The purchase didn’t go through.')))));
    m.requestPurchase({ request: { apple: { sku: PLAN_PRODUCT } }, type: 'subs' }).catch(e => done(() => reject(e)));
  });
}

/** Restore Purchases: hands the App Store's current record to the relay. */
export async function restorePlan(): Promise<BillingStatus> {
  const m = await iap();
  const owned = (await m.getAvailablePurchases()).filter(p => p.productId === PLAN_PRODUCT && p.purchaseToken);
  for (const p of owned) await submitApplePurchase(p.purchaseToken!);
  return billingStatus();
}
