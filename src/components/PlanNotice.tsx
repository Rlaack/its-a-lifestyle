import { useState } from 'react';
import { router } from 'expo-router';
import { Button, Notice, Screen, T } from './ui';
import { toast } from './Toast';
import { useHoodPlan } from '@/data/billing';
import { coverNeighborhood } from '@/data/secure/sync';
import { useStore } from '@/data/store';

export const useHoodPaused = () => { const cur = useStore(s => s.cur); return useHoodPlan(cur)?.state === 'paused'; };

/** Neighborhood page: what happens now that its plan lapsed, and who can fix it. */
export function PlanNotice({ isOwner }: { isOwner: boolean }) {
  const cur = useStore(s => s.cur);
  const plan = useHoodPlan(cur);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => Date.now());
  if (!plan || plan.state === 'active') return null;
  const canAct = isOwner || plan.takeover;
  const cover = async () => {
    setBusy(true);
    try {
      const r = await coverNeighborhood(cur);
      if (r === 'need-plan') router.push('/subscribe');
      else toast(r === 'took-over' ? 'You’re the owner now. Thanks for keeping it going.' : 'Your plan now covers this neighborhood.');
    } catch (e) { toast(e instanceof Error && !/relay/.test(e.message) ? e.message : 'Couldn’t reach the server. Nothing changed.'); }
    finally { setBusy(false); }
  };
  const left = Math.max(0, Math.ceil((plan.until + 30 * 864e5 - now) / 864e5));
  return <>
    <Notice icon="shield" title={plan.state === 'paused' ? 'This neighborhood is paused' : 'The owner’s plan has ended'}>
      {plan.state === 'paused'
        ? 'Everything is still here, but new plans, shared chat messages and new members are on hold until someone subscribes.'
        : `Everything keeps working for ${left} more day${left === 1 ? '' : 's'}.`}
      {!isOwner && !plan.takeover ? ' The owner has a few days to renew first. After that, any member can take over.' : ''}
    </Notice>
    {canAct && <Button kind="primary" label={busy ? 'Working…' : isOwner ? 'Keep this neighborhood going' : 'Subscribe and become the owner'} onPress={busy ? () => {} : cover} />}
  </>;
}

export function PausedScreen() {
  return (
    <Screen back title="Neighborhood paused">
      <T variant="muted">New plans are on hold until someone subscribes. You can see what’s here, and the neighborhood page shows how to bring it back.</T>
      <Button kind="primary" label="Open the neighborhood page" onPress={() => router.replace('/neighborhood')} />
    </Screen>
  );
}
