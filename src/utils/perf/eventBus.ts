/**
 * One shared Tauri listener per event name, ref-counted, fanned out
 * synchronously. Replaces N per-hook `listen()` calls for the same event.
 * Used by background paths only (coalescers, query invalidation); real-time
 * files use realtimeChannel and their own listeners.
 */
import { listen } from "@tauri-apps/api/event";
import { assertBackgroundEvent } from "./laneRegistry";

type Handler = (payload: unknown) => void;

interface Slot {
  handlers: Set<Handler>;
  unlisten?: () => void;
  released: boolean;
  starting: Promise<void>;
}

const slots = new Map<string, Slot>();

/** Subscribe to a BACKGROUND event. Throws for real-time/unclassified names. */
export function subscribeEvent(name: string, handler: Handler): () => void {
  assertBackgroundEvent(name, "eventBus");
  let slot = slots.get(name);
  if (!slot) {
    const created: Slot = {
      handlers: new Set(),
      released: false,
      starting: Promise.resolve(),
    };
    created.starting = Promise.resolve(
      listen<unknown>(name, (event) => {
        for (const h of [...created.handlers]) {
          try {
            h(event.payload);
          } catch (err) {
            console.error(`[perf] handler for ${name} threw`, err);
          }
        }
      }),
    )
      .then((un) => {
        if (created.released) un();
        else created.unlisten = un;
      })
      .catch(() => undefined);
    slots.set(name, created);
    slot = created;
  }
  const active = slot;
  active.handlers.add(handler);
  return () => {
    active.handlers.delete(handler);
    if (active.handlers.size === 0 && slots.get(name) === active) {
      slots.delete(name);
      active.released = true;
      active.unlisten?.();
    }
  };
}

/** Number of live Tauri listeners (tests/metrics). */
export function activeEventListeners(): number {
  return slots.size;
}
