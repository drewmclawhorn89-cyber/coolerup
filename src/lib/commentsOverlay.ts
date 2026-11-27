import { useSyncExternalStore } from "react";

let openCount = 0;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export function openBottomSheetOverlay(): void {
  openCount += 1;
  notify();
}

export function closeBottomSheetOverlay(): void {
  openCount = Math.max(0, openCount - 1);
  notify();
}

export const openCommentsOverlay = openBottomSheetOverlay;
export const closeCommentsOverlay = closeBottomSheetOverlay;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return openCount > 0;
}

/** True while any bottom sheet (Comments, Share, Quality, etc.) is open so mobile bottom nav hides cleanly. */
export function useBottomSheetOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export const useCommentsSheetOpen = useBottomSheetOpen;
