# Safe mode (crash and hang loop breaker)

If the app does not exit gracefully five times in a row, the next start runs in
safe mode so a bad auto-restored workspace cannot keep hanging the app.

## How it works

Tracking lives in the Rust backend (`src-tauri/src/safe_mode.rs`), so it works
even when the frontend never loads. Files are under `<app data>/safe-mode/`:

| File | Purpose |
| --- | --- |
| `running.lock` | Advisory lock held while the app runs. The OS frees it when the process dies, so a free lock plus a leftover marker means the last run ended uncleanly. A busy lock means another instance is alive; it is left alone. |
| `running.marker` | Written at start (pid, start time, version); removed on graceful exit (`RunEvent::Exit`). |
| `state.json` | Consecutive unclean exit counter, last timestamps, threshold, "start next time" flag. |

Rules:

- Leftover marker at start: counter + 1. Graceful exit: counter reset to 0.
- Counter >= threshold (default 5; `0` disables): safe mode.
- A safe-mode run clears the counter on graceful exit only after 60 seconds of
  uptime, or immediately via "Restart normally".
- Fail open: IO or lock errors, a corrupt marker or a corrupt state file never
  block startup (corruption counts as a clean exit). User data is never read,
  changed or deleted by this feature.
- Debug builds (`tauri dev`, where hot restarts kill the process) do not count
  unless `SORNG_SAFE_MODE_TRACK_DEV=1`.

## What safe mode changes

- No automatic workspace restore (sessionStorage rows, durable snapshot,
  live-session adoption), and the saved snapshot is not overwritten.
- No preload scheduler tasks or startup prefetch, no origin browser prewarm.
- No SSH auto-reconnect on unexpected disconnect.
- Connections list, settings and credentials stay fully usable.

A compact banner offers Restart normally, Restore previous workspace (one-shot,
after a confirmation about possible hangs), Stay in safe mode (dismiss) and a
Details expander (counter, threshold, last unclean timestamps, previous marker).

## Configuration

- Settings > Behavior > Safe mode: threshold, "Start in safe mode next time"
  (one-shot), and "Simulate unclean exits".
- `--safe-mode` argument or `SORNG_SAFE_MODE=1`: force safe mode for that start.
- `SORNG_SAFE_MODE_THRESHOLD=N`: override the threshold (beats the setting).

## Testing without crashing the app five times

- Settings > Behavior > Safe mode > "Simulate unclean exits", then restart the
  app: it starts in safe mode with the counter at the threshold.
- Or start with `SORNG_SAFE_MODE_SIMULATE_UNCLEAN=5`.
- Or kill the release app five times (Task Manager) and relaunch.

Backend commands: `safe_mode_status`, `safe_mode_update_config`,
`safe_mode_simulate_unclean_exits`, `safe_mode_restart_normally`.
