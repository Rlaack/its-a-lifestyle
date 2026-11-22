// Shapes of everything the app shows. Today they come from local sample data;
// later each one maps to an end-to-end encrypted record (see the build plan's data model).

export type PlanType = 'gathering' | 'beacon' | 'potluck' | 'paddle' | 'walk' | 'help' | 'mealtrain' | 'games' | 'surprise' | 'poll' | 'challenge';
export type Audience = 'all' | 'pick' | 'except' | `cal:${string}`;
export type Reactions = Record<string, string[]>;

export type ListItem = { name: string; by: string | null };
export type SignupList = { cat: string; items: ListItem[] };
export type MealSlot = { meal: 'Lunch' | 'Dinner'; by: string | null; what?: string };
export type MealDay = { d: string; slots: MealSlot[]; note?: string };
export type PollOption = { t: string; v: string[]; iso?: string };
/** How a challenge is scored.
 *  time: minutes, in blocks of `per` (exercise)   distance: miles or km, per `per` units
 *  count: anything counted (push-ups, books), per `per` units   tasks: each task has its own points
 *  checkin: one check-in a day ("no soda today") */
export type ChallengeMode = 'time' | 'distance' | 'count' | 'tasks' | 'checkin';
/** Effort levels and the points one block earns at that level (Light 1, Hard 2). */
export type ChallengeLevel = { name: string; pts: number };
export type ChallengeTask = { name: string; pts: number };
/** One logged entry. `amount` is minutes, distance, a count, or 1 for a task or check-in. */
export type ChallengeEntry = { id: string; who: string; day: string; what: string; amount: number; level: number };
/** Teams: people pick at sign-up, the organizer assigns, or a random even split. `of` maps person → team. */
export type ChallengeTeams = { names: string[]; assign: 'choose' | 'organizer' | 'random'; of: Record<string, string> };
/** A friendly, honor-system challenge. */
export type Challenge = {
  mode: ChallengeMode; start: string; end: string; signupBy: string;
  per: number; unit?: string; levels: ChallengeLevel[]; tasks?: ChallengeTask[];
  counts: string[]; teams?: ChallengeTeams; log: ChallengeEntry[];
};

export type Plan = {
  id: string; type: PlanType; title: string; host: string;
  y?: number; m: number; d: number; dow: string; time: string; where: string; precision: string;
  audience: Audience; invited?: string[]; excluded?: string[];
  going: string[]; maybe?: string[]; rsvp: 'going' | 'maybe' | 'no' | null;
  note?: string | null; r?: Reactions; remind?: string[];
  live?: boolean; when?: string; dist?: string;           // beacons
  lists?: SignupList[];                                     // potluck, games, paddle, help
  days?: MealDay[]; for?: string; address?: string; dropoff?: string; diet?: string; // meal trains
  route?: string; pace?: string; recurring?: string;        // hikes and paddles
  kind?: 'date' | 'yesno' | 'choice'; multi?: boolean; closes?: string; options?: PollOption[]; // polls
  calCopy?: { via: 'phone' | 'google' } | null;               // a copy saved to the user's own calendar
  challenge?: Challenge;                                     // challenges (people who signed up are in `going`)
  end?: string;                                             // multi-day plans (camping trips): last day, YYYY-MM-DD
  mapAddress?: string;                                      // a street address people can tap to navigate
};

export type Message =
  | { f: 'sys'; t: string }
  | { f: 'key'; who: string }
  | { f: 'device'; who: string; dev: string }
  | { f: string; t?: string; type?: 'photo' | 'file' | 'loc' | 'voice'; src?: string; uri?: string; alt?: string; name?: string; size?: string; dur?: string; geo?: string; exp?: number; r?: Reactions;
      /** Encrypted chats: message ID inside the encryption, and delivery state of my own messages. */
      mid?: string; status?: 'sending' | 'sent' | 'failed';
      /** Restored from a backup, which doesn't include photos, voice messages or files. */
      gone?: boolean };

/** An end-to-end encrypted conversation with one neighbor, keyed by their random relay account ID. */
export type SecureLink = { account: string; verified: boolean; unknown?: boolean };
/** A chat shared through an encrypted group: a plan's chat in a real neighborhood, or a group chat. */
export type SharedLink = { group: string; plan?: string };
export type Chat = { id: string; gid?: string; name: string; members: number; icon?: string; secret?: boolean; timer?: string; people?: string[]; msgs: Message[]; secure?: SecureLink; shared?: SharedLink;
  /** A read-only notice chat made by the app (reports for owners). */
  system?: boolean };
export type Calendar = { name: string; n: number; tone: 'pine' | 'ember' | 'plum' | 'sky'; on: boolean; members?: string[] };
/** `account` is set for real members of a neighborhood on the relay (their random account ID). */
export type Member = { n: string; by: string; inv: boolean; account?: string };

export type Neighborhood = {
  name: string; about: string; owner: string; owners: string[]; code: string; places: string[];
  /** Shared neighborhoods: the current invite code, if an owner changed it (`code` stays the local key). */
  invite?: string;
  inviters: 'everyone' | 'chosen'; joined: boolean; more: number; members: Member[]; extra?: Member[];
  /** A hand-drawn map of this neighborhood's water and trails. Only neighborhoods that have one show maps and the lake scene. */
  map?: 'lake';
  /** Owner-chosen cover picture: a photo on this phone, the neighborhood drawing, or none. */
  /** `att`: shared neighborhoods, where the encrypted photo is on the relay (so members get it too). */
  cover?: { kind: 'photo'; uri: string; att?: { id: string; key: string; digest: string } } | { kind: 'drawing' } | { kind: 'none' };
  /** Set for neighborhoods that live on the relay: the code is the secret that unlocks the member list. */
  remote?: boolean;
};

export type Visibility = { phone: string; address: string; location: string };
export type Device = { name: string; kind: 'mobile' | 'tablet'; os: string; when: string };
export type Security = { lock: boolean; blur: boolean; disappear: string };
export type Me = {
  name: string; street: string; remindDefault: string; vis: Visibility; visPeople?: Record<string, string[]>;
  calPref?: 'phone' | 'google' | null; sec: Security; devices: Device[];
};
