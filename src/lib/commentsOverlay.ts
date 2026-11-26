import { useSyncExternalStore } from "react";

let openCount = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function openCommentsOverlay(): void {
  openCount += 1;
  notify();
}

export function closeCommentsOverlay(): void {
  openCount = Math.max(0, openCount - 1);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return openCount > 0;
}

/** True while any video Comments bottom sheet is open so mobile bottom nav hides cleanly. */
export function useCommentsSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
