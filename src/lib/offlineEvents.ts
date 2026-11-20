/** Event names shared by the offline library and the screens that feed it. */

/** Fired when the user likes/saves something, so Offline Mode can catch up. */
export const OFFLINE_SYNC_EVENT = "coolerup-offline-sync";

/** Ask the Offline Mode watcher to run a sync soon. */
export function requestOfflineSync(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_SYNC_EVENT));
}
