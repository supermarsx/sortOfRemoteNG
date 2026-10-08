---
title: SSH output buffering and recovery
eyebrow: SSH
description: Configure adaptive terminal replay buffers and recover delayed output.
permalink: /ssh-terminal-buffering/
---

# SSH output buffering and recovery

Settings → SSH → Output replay buffer controls the native history retained for
all SSH sessions, including detached windows. This is separate from xterm's
scrollback-line setting and from session recordings.

| Setting                      | Default  | Allowed values                     |
| ---------------------------- | -------- | ---------------------------------- |
| Mode                         | Adaptive | Adaptive or Fixed                  |
| Adaptive minimum per session | 1 MiB    | 1–100 MiB, no greater than maximum |
| Adaptive maximum per session | 100 MiB  | 1–100 MiB                          |
| Fixed target per session     | 50 MiB   | 1–100 MiB                          |
| Shared replay budget         | 256 MiB  | 16–1024 MiB                        |

Buffers allocate storage only as output arrives. Adaptive mode starts at the
minimum and grows on demand, within the per-session ceiling and each session's
fair share of the total budget. Opening more sessions reduces that fair share;
closing them allows future growth. Fixed mode uses the configured target, still
subject to the shared cap and memory-pressure safeguards.

The existing memory watchdog supplies heap/system pressure; no additional memory
probe is started. Each window reports every five seconds. The backend applies
the strongest unexpired report across windows; reports expire after 30 seconds.
Only the main window changes the global configuration. Warning, critical and
pressure states reduce shared and per-session ceilings by factors of 2, 4 and 8.
The adaptive minimum (at least 1 MiB) is kept where the shared budget permits.
The shared safety cap takes priority if there are too many sessions to maintain
every minimum. Turning off the watchdog disables pressure-driven adaptation,
but not session-count sharing or configured hard caps.

Shrinking removes the oldest history at UTF-8 boundaries and releases excess
native allocation. Already-displayed output remains displayed. Increasing a cap
cannot restore history that was previously evicted.

## Delivery and recovery

- Ordinary history eviction is not reported as lost live output.
- Live stream sequence gaps and frontend queue overflow request native replay
  from the last acknowledged cursor, before showing a loss warning.
- Replay is fetched in pages of at most 256 KiB. Pages drain through the terminal
  before the next page is requested; large native histories are not copied into
  one giant JavaScript string. At most four replay requests per window are in
  flight, even when many terminals resume together.
- Each registration has at most one xterm output write awaiting its completion
  callback. The delivery cursor advances only after that callback.
- Inactive terminals retain native history rather than duplicating live output
  in their JavaScript queues. Reactivation requests replay.
- Transient replay failures retry with exponential backoff from 500 ms to
  30 seconds. Disposal cancels scheduled work and ignores late responses.
- If unread bytes have already expired from native history, the terminal reports
  that unread interval, not the lifetime count of evicted bytes.

These limits bound replay payload storage, not total application RAM: terminal
scrollback, decoded strings, recordings, rendering and IPC have separate costs.
This is not a disk-backed audit log or an unlimited lossless queue. Sustained
output faster than the consumer can still outlive finite retention. Recovery
handles detected gaps and reattachment; it cannot reconstruct evicted data or
data never read from the SSH transport. The legacy unsequenced buffer API returns
only the newest 256 KiB; current viewers use paged, sequence-aware replay.
