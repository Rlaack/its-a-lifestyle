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

type Iap = Awaited<ReturnType<typeof iap>>;

/** Hands the App Store's current record to the relay, so a plan this Apple ID already owns follows it to a new account. */
async function claimOwned(m: Iap) {
  const owned = (await m.getAvailablePurchases()).filter(p => p.productId === PLAN_PRODUCT && p.purchaseToken);
  let active = false;
  for (const p of owned) active = (await submitApplePurchase(p.purchaseToken!)).active || active;
  return active;
}

/** Opens Apple's purchase sheet, unless this Apple ID already owns the plan. Resolves true once the relay has verified it. */
export async function buyPlan(): Promise<boolean> {
  const m = await iap();
  if (await claimOwned(m)) return true;
  await m.fetchProducts({ skus: [PLAN_PRODUCT], type: 'subs' });
  return new Promise<boolean>((resolve, reject) => {
    let settled = false, taken = false;
    const done = (f: () => void) => { if (settled) return; settled = true; ok.remove(); bad.remove(); f(); };
    const cancelled = (e: unknown) => (e as { code?: string })?.code === m.ErrorCode.UserCancelled;
    const failed = (e: unknown) => done(() => (cancelled(e) ? resolve(false) : reject(new Error('The purchase didn’t go through.'))));
    const take = async (purchase: { productId: string; purchaseToken?: string | null }) => {
      if (taken || purchase.productId !== PLAN_PRODUCT || !purchase.purchaseToken) return;
      taken = true;
      try {
        const s = await submitApplePurchase(purchase.purchaseToken);
        // Finish only after the relay has it, so an interrupted purchase is delivered again.
        await m.finishTransaction({ purchase: purchase as Parameters<typeof m.finishTransaction>[0]['purchase'], isConsumable: false });
        done(() => resolve(s.active));
      } catch (e) { done(() => reject(e)); }
    };
    const ok = m.purchaseUpdatedListener(take);
    const bad = m.purchaseErrorListener(failed);
    // The listener skips a transaction it has already seen this session, so also use the direct result.
    m.requestPurchase({ request: { apple: { sku: PLAN_PRODUCT } }, type: 'subs' })
      .then(r => { const p = Array.isArray(r) ? r[0] : r; if (p) return take(p); })
      .catch(failed);
  });
}

/** Restore Purchases: hands the App Store's current record to the relay. */
export async function restorePlan(): Promise<BillingStatus> {
  await claimOwned(await iap());
  return billingStatus();
}
