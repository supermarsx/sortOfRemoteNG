---
title: Performance core
eyebrow: Contribute
description: The real-time versus background lane model, and how to add a cached query, a coalesced event, a preload, and the guards that keep terminals and RDP untouched.
permalink: /performance-core/
---

The performance core (`src/utils/perf/`, `src/hooks/perf/`) makes background work cheap: caching with reconciliation, event coalescing, visibility-aware polling and idle preloads. It must never add latency to anything the user is typing into or watching live.

## Lane model

| Lane         | What belongs there                                                                                                                                                                 | What the core may do                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `realtime`   | SSH, serial, telnet, rlogin output and input, RDP and VNC frames, pointer and clipboard, origin browser input and prompts, lock and auth events, every write or mutation           | Nothing. Same-tick pass-through only (`realtimeChannel`). No cache, timer, dedupe |
| `background` | Session and device lists, stats and status polls, thumbnails, logs and progress feeds, settings and document change notices, 1 s elapsed-time ticks, read-only lists on panel open | Cache, dedupe, coalesce, pause while hidden, structural sharing                   |

`src/utils/perf/laneRegistry.ts` is the single source of truth. An unclassified event or command is treated as `realtime`. To make something background, add it to `BACKGROUND_EVENTS` there; that edit needs review.

## Add a cached query

```ts
import { useQuery } from "../hooks/perf/useQuery";
import { invokeFetcher, invokeQueryKey } from "../utils/perf/cachedInvoke";

const { data } = useQuery(
  invokeQueryKey("list_things", { scope }),
  invokeFetcher("list_things", { scope }),
  { ttlMs: 5000, select: (d) => d.items },
);
```

- Keys are `"<namespace>:<anything>"`; the LRU cap is per namespace. The active database id is part of every key (`setCacheScope`).
- Equal data keeps object identity (`structuralShare`), so memoized rows do not re-render. For lists use `mergeById`, or `useStableRows(rows, idOf)` for derived rows.
- Polls use `usePollingQuery(key, fetcher, ms)` or `useVisibleInterval(cb, ms)`: paused while hidden, one catch-up call on return, no burst.
- Elapsed-time UI uses `useSharedTick()` or `useSharedNow(enabled)`: one shared 1 s timer for the whole app.
- Per-device panels (iDRAC, Proxmox) use `swrLoad`: paint the cached value first, revalidate behind it. After a write, call `invalidateDevice`.
- Refused on purpose: real-time commands, write verbs, anything with `vault`, `password`, `secret`, `totp`, `dek`, `credential` or `token` in its name. Values with such fields throw in dev. Caches are memory only and are wiped on lock and on database switch.

## Add a coalesced event

```ts
useCoalescedEvent<Payload>(
  "my-progress-event",
  (batch, count) => apply(batch),
  { kind: "frame" }, // or { kind: "interval", ms: 250 }, "lastWriteWins", "count"
);
```

1. Add the event name to `BACKGROUND_EVENTS` in `laneRegistry.ts`. Without that, registration throws.
2. All coalescers cap their latency (`maxWaitMs`), flush on unmount and can be paused.
3. Real-time event handlers do not use coalescers. If a real-time file needs the metrics counter, wrap the handler in `realtimeChannel(name, handler)`, which runs it synchronously.

## Add a preload

Preloads warm code, not secrets. Everything goes through `src/utils/perf/preloadScheduler.ts`: deferred (not dropped) while the user is typing, a busy probe reports activity or the window is hidden; at most two concurrent tasks; slices bounded by a frame budget.

1. Add the panel's `import()` thunk to `PANEL_CHUNKS` in `src/utils/perf/preloadPlan.ts`. It must resolve to the same module as the `dynamic()` call that renders it.
2. Spread `{...panelIntent("myPanel")}` on the button that opens it (hover or focus, 80 ms debounce, priority 1). Add it to `IDLE_WARMUP_PANELS` only if most sessions open it; idle warmup runs at priority 3, 3 s after startup.
3. For data, use `schedulePreload({ id, requires: "unlocked", run })`. Such tasks run only when the lock state is explicitly `unlocked`, are dropped on lock and never prompt or unlock. `secret: true` is rejected at registration.
4. The app shell calls `setLockState` (see `useGlobalEncryptionGuard`) and `setCacheScope` (`useCacheScope`). Other caches join the lock flush with `registerCache(name, { clear })`.

## Guards and rules

- `src/utils/perf/__tests__/realtimeBypass.guard.test.ts` statically checks that the real-time files (SSH, serial, telnet, RDP client, VNC console, RDP trust prompt) import nothing from the core except `realtimeChannel`.
- `coalescer.test.ts` fails if any name in `REALTIME_EVENTS` can be registered as background.
- Do not touch frames, pointer or clipboard handlers, terminal or serial output, telnet data or VNC input to "optimize" them. Do not add a cache in front of a command that changes state.
- Never put a secret in a cache or a preload, and never persist a cache (no localStorage, IndexedDB or disk).
- Prefer `npx prettier --check <files>` for gates, and never run `vitest` with `--exclude`.

## Measure

Enable counters with `localStorage.sorngPerf = 1` or `?perf=1`, then reload.

- `window.__sorngPerf.report()` prints counters (`cache.hit/miss/dedupe`, `invoke:<cmd>`, `coalesce.in/out`, `rt:<name>`, `preload.*`) and the number of cache entries.
- In development builds, a small overlay in the corner shows the same counters. The overlay is mounted from `src/App.tsx` behind a `NODE_ENV` check, so production bundles do not contain it.
- `beginScope("tab:proxmox")` records invokes per panel open.
