import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { PeoplePicker } from '@/components/PeoplePicker';
import { toast } from '@/components/Toast';
import { Button, IconButton, Screen, T } from '@/components/ui';
import { actions, useStore } from '@/data/store';

const NONE: string[] = [];
const LABEL = { phone: 'phone number', address: 'address', location: 'location' } as const;

// "Pick people" for phone, address or location. Closing with no one picked hides the field, never shares it.
export default function VisibilityPeople() {
  const { field } = useLocalSearchParams<{ field: keyof typeof LABEL }>();
  const k = (field in LABEL ? field : 'phone') as keyof typeof LABEL;
  const saved = useStore(s => s.me.visPeople?.[k] ?? NONE);
  const [people, setPeople] = useState<string[]>(saved);
  const done = () => {
    actions.setVisibilityPeople(k, people);
    router.back();
    toast(people.length ? `Your ${LABEL[k]} is visible to ${people.length} ${people.length === 1 ? 'neighbor' : 'neighbors'}` : `No one picked, so your ${LABEL[k]} is hidden`);
  };
  return (
    <Screen sheet title="Who can see it" right={<IconButton name="check" label="Done" onPress={done} />}>
      <T variant="muted">Pick the neighbors who can see your {LABEL[k]}. Everyone else can’t.</T>
      <PeoplePicker value={people} onChange={setPeople} summaryLabel="Can see it: " />
      {!people.length && <T variant="muted">No one can see it until you pick someone.</T>}
      <Button kind="primary" label="Done" onPress={done} />
    </Screen>
  );
}
