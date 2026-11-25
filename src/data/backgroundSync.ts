import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { syncInBackground } from './secure/sync';

// A silent push from the relay wakes the app in the background (even if it wasn't running). This task
// fetches and decrypts what's waiting, which shows each new thing as a notification with its real text.
// Defined when the app loads (imported first thing by the root layout), as expo-task-manager requires.
const WAKE_TASK = 'lifestyle-wake';

TaskManager.defineTask(WAKE_TASK, async () => {
  if (__DEV__) console.log('[push] woken in the background');
  try {
    return (await syncInBackground()) ? Notifications.BackgroundNotificationTaskResult.NewData : Notifications.BackgroundNotificationTaskResult.NoData;
  } catch {
    return Notifications.BackgroundNotificationTaskResult.Failed;
  }
});

Notifications.registerTaskAsync(WAKE_TASK).catch(e => { if (__DEV__) console.log('[push] background task not registered', String(e)); });
