import type { IconName } from '@/theme/paths';
import type { Tone } from '@/theme/tokens';
import type { PlanType } from './types';

export const PLAN_TYPES: Record<PlanType, { label: string; icon: IconName; tone: Tone; blurb: string }> = {
  gathering: { label: 'Get-together', icon: 'users', tone: 'pine', blurb: 'Any plan, big or small' },
  beacon: { label: 'Beacon', icon: 'flame', tone: 'ember', blurb: 'Happening right now, come by' },
  potluck: { label: 'Potluck', icon: 'pot', tone: 'ember', blurb: 'Menu with dish sign-ups' },
  paddle: { label: 'Paddle', icon: 'paddle', tone: 'sky', blurb: 'Kayak, canoe or SUP' },
  walk: { label: 'Hike', icon: 'route', tone: 'pine', blurb: 'Trail, pace and meet-up spot' },
  challenge: { label: 'Challenge', icon: 'trophy', tone: 'pine', blurb: 'Exercise, chores, reading: friendly competition' },
  help: { label: 'Lend a hand', icon: 'hand', tone: 'ember', blurb: 'Ask neighbors for help' },
  mealtrain: { label: 'Meal train', icon: 'heart', tone: 'sky', blurb: 'Bring meals to a neighbor' },
  games: { label: 'Game night', icon: 'dice', tone: 'plum', blurb: 'Who’s bringing what' },
  surprise: { label: 'Surprise', icon: 'gift', tone: 'plum', blurb: 'Hidden from the guest of honor' },
  poll: { label: 'Poll', icon: 'poll', tone: 'sky', blurb: 'Pick a date or settle a question' },
};

export const POST_REACTIONS: [string, string][] = [['❤️', 'Love'], ['👍', 'Like'], ['👎', 'Dislike'], ['🙏', 'Thank you']];
export const CHAT_REACTIONS = ['❤️', '👍', '👎', '🙏', '😂', '🔥'];
