use std::sync::Arc;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebouncedEvent};
use tokio::sync::mpsc;

use crate::engine::I18nEngine;
use crate::error::I18nResult;

/// Configuration for the hot-reload watcher.
#[derive(Debug, Clone)]
pub struct WatcherConfig {
    /// Debounce interval — events within this window are coalesced.
    pub debounce: Duration,
    /// Whether to watch recursively (needed if namespace dirs are nested).
    pub recursive: bool,
}

impl Default for WatcherConfig {
    fn default() -> Self {
        Self {
            debounce: Duration::from_millis(300),
            recursive: true,
        }
    }
}

/// A handle to the running file-watcher.
///
/// Dropping this handle stops the watcher background task.
pub struct I18nWatcher {
    /// Hold the debouncer alive — dropping it stops watching.
    _debouncer: notify_debouncer_mini::Debouncer<RecommendedWatcher>,
    /// Join handle for the async consumer task.
    _task: tokio::task::JoinHandle<()>,
}

impl I18nWatcher {
    /// Start watching the locale directory used by `engine`.
    ///
    /// On every file change the engine's `reload_all()` is called so content
    /// is atomically swapped.  An optional `on_reload` callback is invoked
    /// *after* reload completes (useful for emitting Tauri events).
    pub fn start(
        engine: Arc<I18nEngine>,
        config: WatcherConfig,
        on_reload: Option<Arc<dyn Fn() + Send + Sync + 'static>>,
    ) -> I18nResult<Self> {
        let dir = engine.locales_dir().to_path_buf();

        let (tx, mut rx) = mpsc::channel::<Vec<DebouncedEvent>>(64);

        // Spawn the notify debouncer on its own thread (notify is sync).
        let debouncer = {
            let tx = tx.clone();
            new_debouncer(
                config.debounce,
                move |result: Result<Vec<DebouncedEvent>, _>| {
                    if let Ok(events) = result {
                        let _ = tx.blocking_send(events);
                    }
                },
            )
            .map_err(|e| crate::error::I18nError::WatcherError(e.to_string()))?
        };

        // Start watching
        let mut debouncer = debouncer;
        let mode = if config.recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        debouncer
            .watcher()
            .watch(dir.as_ref(), mode)
            .map_err(|e| crate::error::I18nError::WatcherError(e.to_string()))?;

        log::info!("i18n: watching {:?} for locale file changes", dir);

        // Async consumer task
        let engine_clone = Arc::clone(&engine);
        let task = tokio::spawn(async move {
            while let Some(events) = rx.recv().await {
                // Only react to JSON file changes
                let any_json = events
                    .iter()
                    .any(|ev| ev.path.extension().map(|e| e == "json").unwrap_or(false));

                if !any_json {
                    continue;
                }

                log::info!("i18n: detected locale file change, reloading…");
                match engine_clone.reload_all() {
                    Ok(()) => {
                        log::info!("i18n: hot-reload successful");
                        if let Some(ref cb) = on_reload {
                            cb();
                        }
                    }
                    Err(e) => {
                        log::error!("i18n: hot-reload failed: {}", e);
                    }
                }
            }
        });

        Ok(I18nWatcher {
            _debouncer: debouncer,
            _task: task,
        })
    }

    /// Start watching with default config and no callback.
    pub fn start_default(engine: Arc<I18nEngine>) -> I18nResult<Self> {
        Self::start(engine, WatcherConfig::default(), None)
    }

    /// Start watching with a Tauri app handle — emits an `i18n-reload` event
    /// to all windows whenever translations are reloaded.
    pub fn start_with_tauri_events(
        engine: Arc<I18nEngine>,
        app_handle: tauri::AppHandle,
    ) -> I18nResult<Self> {
        use tauri::Emitter;

        let callback: Arc<dyn Fn() + Send + Sync + 'static> = Arc::new(move || {
            let _ = app_handle.emit("i18n-reload", ());
        });

        Self::start(engine, WatcherConfig::default(), Some(callback))
    }
}
