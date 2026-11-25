import { handleIncomingUrl } from '@/data/links';
import { getState } from '@/data/store';

// Invite links open the app at the website's address (universal links). Send them to the right screen
// instead of a "page not found": join links to the Join screen, chat links to the connect sheet.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const kind = handleIncomingUrl(path);
    // Already in a neighborhood: the Join form. Not in one yet: the first screen, which is the Join screen.
    if (kind === 'join') return getState().hood.joined ? '/start?mode=join' : '/';
    if (kind === 'connect') return '/connect';
  } catch { /* fall through to the normal route */ }
  return path;
}
