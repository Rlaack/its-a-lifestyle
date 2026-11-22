import type { PlanType } from './types';

// What each kind of plan asks for. Every option here was chosen for that kind of plan:
// a potluck happens at a home or the clubhouse, a paddle puts in at the beach, a hike meets at the trail.
// Quick-pick places only appear if the neighborhood has that common place; "My place" is always allowed,
// and every plan with a place also has a free-text box for anywhere else.

export type When =
  | { kind: 'datetime'; defaultTime: string; timeLabel: string }   // calendar date + time
  | { kind: 'now' }                                                // beacons: happening now, with an "until" time
  | { kind: 'range' }                                              // meal trains: start and end dates
  | { kind: 'poll' };                                              // polls: a closing date (and dates to vote on)

export type FormSpec = {
  when: When;
  place?: { label: string; picks: string[]; placeholder: string };
  list?: { label: string; hint: string; placeholder: string; defaults: string[]; category: string };
  route?: { label: string; placeholder: string };
  detailsPlaceholder?: string;
  titleLabel: string;
  titlePlaceholder: string;
  /** Quick titles. A [title, place] pair only shows if the neighborhood has that common place. */
  suggestions?: (string | [string, string])[];
  defaultAudience?: 'all' | 'except';
};

export const FORM_SPECS: Record<PlanType, FormSpec> = {
  gathering: {
    titleLabel: 'Name it', titlePlaceholder: 'Backyard cookout',
    when: { kind: 'datetime', defaultTime: '18:00', timeLabel: 'Starts at' },
    place: { label: 'Where', picks: ['My place', 'Clubhouse', 'Beach'], placeholder: 'Type a place, like the Hendersons’ yard' },
    detailsPlaceholder: 'Anything people should know: what to bring, where to park, kids and dogs welcome',
  },
  beacon: {
    titleLabel: 'What’s going on?', titlePlaceholder: 'Campfire’s lit',
    suggestions: ['Campfire’s lit', 'Porch hangout', 'Out in the yard', ['Out on the lake', 'Lake'], ['Beach hang', 'Beach'], ['Kids at the beach', 'Beach']],
    when: { kind: 'now' },
    place: { label: 'Where', picks: ['My place', 'Beach', 'Lake'], placeholder: 'Type a place, like the fire pit out back' },
    detailsPlaceholder: 'Bring a chair, plenty of firewood, kids welcome',
  },
  potluck: {
    titleLabel: 'Name it', titlePlaceholder: 'Chili cook-off',
    when: { kind: 'datetime', defaultTime: '17:00', timeLabel: 'Starts at' },
    place: { label: 'Where', picks: ['My place', 'Clubhouse'], placeholder: 'Type a place, like the Hendersons’ house' },
    list: { label: 'The menu', hint: 'One dish or item per line. Neighbors tap one to claim it.', placeholder: 'Main dish\nVegetarian main\nSalad\nDessert\nDrinks', defaults: ['Main dish', 'Side', 'Dessert', 'Drinks'], category: 'Menu' },
    detailsPlaceholder: 'Theme, allergies to avoid, bring your own chairs',
  },
  paddle: {
    titleLabel: 'Name it', titlePlaceholder: 'Sunrise paddle',
    when: { kind: 'datetime', defaultTime: '09:00', timeLabel: 'Put in at' },
    place: { label: 'Meet at', picks: ['Beach', 'Lake'], placeholder: 'Where to put in, like the river access on Mill Rd' },
    route: { label: 'Route', placeholder: 'Where you’ll paddle and about how long' },
    list: { label: 'Spare gear and sign-ups', hint: 'One per line. Neighbors tap one to claim it.', placeholder: 'Spare kayak + PFD\nPaddleboard\nThermos of cocoa', defaults: ['Spare kayak', 'Spare PFD'], category: 'Gear' },
    detailsPlaceholder: 'Water temperature, what to wear, all boats welcome',
  },
  walk: {
    titleLabel: 'Name it', titlePlaceholder: 'Morning trail hike',
    when: { kind: 'datetime', defaultTime: '08:00', timeLabel: 'Starts at' },
    place: { label: 'Meet at', picks: ['Trail', 'Clubhouse', 'Beach'], placeholder: 'Type a spot, like the end of Fawn Ln' },
    route: { label: 'Route and pace', placeholder: 'About 3 miles, easy pace' },
    detailsPlaceholder: 'Dogs welcome, muddy in spots, bring water',
  },
  challenge: {
    titleLabel: 'Name it', titlePlaceholder: 'Move-it month',
    suggestions: ['Move-it month', 'Get outside challenge', 'Winter warm-up'],
    when: { kind: 'range' },
    detailsPlaceholder: 'Why we’re doing it, how to log, any bragging rights for the winner',
  },
  help: {
    titleLabel: 'What do you need help with?', titlePlaceholder: 'Splitting firewood',
    when: { kind: 'datetime', defaultTime: '09:00', timeLabel: 'Starts at' },
    place: { label: 'Where', picks: ['My place'], placeholder: 'Type a place' },
    list: { label: 'What’s needed', hint: 'One per line: people, tools or a truck. Neighbors tap “I’m in.”', placeholder: 'Strong back\nStrong back\nChainsaw\nPickup truck', defaults: ['Helper', 'Helper'], category: 'What’s needed' },
    detailsPlaceholder: 'How long it should take, coffee and donuts after',
  },
  games: {
    titleLabel: 'Name it', titlePlaceholder: 'Poker night',
    when: { kind: 'datetime', defaultTime: '19:00', timeLabel: 'Starts at' },
    place: { label: 'Where', picks: ['My place', 'Clubhouse'], placeholder: 'Type a place' },
    list: { label: 'Who’s bringing what', hint: 'One per line: games, snacks, drinks.', placeholder: 'A board game\nSnacks\nDrinks', defaults: ['A game', 'Snacks'], category: 'Bring' },
    detailsPlaceholder: 'Which games, buy-in if any, kid-friendly or adults only',
  },
  surprise: {
    titleLabel: 'Name it', titlePlaceholder: 'Lena’s retirement',
    when: { kind: 'datetime', defaultTime: '18:30', timeLabel: 'Party starts at' },
    place: { label: 'Where', picks: ['My place', 'Clubhouse'], placeholder: 'Type a place' },
    detailsPlaceholder: 'Arrive 15 minutes early, park out of sight, keep it quiet',
    defaultAudience: 'except',
  },
  mealtrain: {
    titleLabel: 'Name it', titlePlaceholder: 'Meals for the Hendersons',
    when: { kind: 'range' },
  },
  poll: {
    titleLabel: 'Question', titlePlaceholder: 'When should we do the beach bonfire?',
    when: { kind: 'poll' },
  },
};
