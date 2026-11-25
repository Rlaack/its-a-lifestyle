import { router, type Href } from 'expo-router';
import { markRead } from './activity';
import { actions, getState } from './store';

/** Opens what a notification is about: switches to its neighborhood if needed, then shows the chat or plan.
 *  If the plan or chat is gone (cancelled, or the neighborhood was left), says so on the bell's list. */
export function openNotification(o: { route?: unknown; hood?: unknown; aid?: unknown }): boolean {
  if (typeof o.aid === 'string') markRead(o.aid);
  const route = typeof o.route === 'string' && o.route.startsWith('/') ? o.route : '/notifications';
  const st = getState();
  if (typeof o.hood === 'string' && o.hood !== st.cur && st.hoodList.some(h => h.id === o.hood)) actions.switchHood(o.hood);
  const now = getState();
  const plan = /^\/event\/(.+)$/.exec(route)?.[1];
  const chat = /^\/chat\/(.+)$/.exec(route)?.[1];
  if ((plan && !now.plans.some(p => p.id === plan)) || (chat && !now.chats.some(c => c.id === chat))) return false;
  if (route === '/') router.navigate('/');
  else router.push(route as Href);
  return true;
}
