//! Keep startup future construction off the webview's small native callback
//! stack. The factory is invoked only when the executor polls this task.
use std::{future::Future, pin::Pin};

pub(crate) fn task<F, Fut>(factory: F) -> Pin<Box<dyn Future<Output = Fut::Output> + Send>>
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future + Send + 'static,
{
    Box::pin(async move { Box::pin(factory()).await })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        task::{Context, Poll, Waker},
        thread,
    };

    fn poll_once<F: Future + ?Sized>(future: Pin<&mut F>) -> Poll<F::Output> {
        future.poll(&mut Context::from_waker(Waker::noop()))
    }

    struct LargeFuture<const N: usize> {
        payload: [u8; N],
    }
    impl<const N: usize> Future for LargeFuture<N> {
        type Output = usize;
        fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<usize> {
            Poll::Ready(self.payload.len() + usize::from(self.payload[0]))
        }
    }

    fn deferred_on_small_ui<const N: usize>(worker_stack: usize) {
        assert!(std::mem::size_of::<LargeFuture<N>>() >= N);
        let called = Arc::new(AtomicBool::new(false));
        let observed = called.clone();
        let future = thread::Builder::new()
            .name("small-ui".into())
            .stack_size(1024 * 1024)
            .spawn(move || {
                let ui_thread = thread::current().id();
                let future = task(move || {
                    assert_ne!(thread::current().id(), ui_thread);
                    observed.store(true, Ordering::SeqCst);
                    LargeFuture::<N> { payload: [7; N] }
                });
                assert_eq!(
                    std::mem::size_of_val(&future),
                    2 * std::mem::size_of::<usize>()
                );
                future
            })
            .unwrap()
            .join()
            .unwrap();
        assert!(
            !called.load(Ordering::SeqCst),
            "factory must not run during UI dispatch"
        );
        let result = thread::Builder::new()
            .name("worker".into())
            .stack_size(worker_stack)
            .spawn(move || {
                let mut future = future;
                match poll_once(future.as_mut()) {
                    Poll::Ready(result) => result,
                    Poll::Pending => panic!("large fixture should complete"),
                }
            })
            .unwrap()
            .join()
            .unwrap();
        assert_eq!(result, N + 7);
        assert!(called.load(Ordering::SeqCst));
    }

    #[test]
    fn realistic_350k_future_constructs_on_two_megabyte_worker_not_ui() {
        deferred_on_small_ui::<{ 350 * 1024 }>(2 * 1024 * 1024);
    }

    #[test]
    fn megabyte_future_crosses_small_ui_as_only_a_boxed_pointer() {
        deferred_on_small_ui::<{ 1024 * 1024 }>(4 * 1024 * 1024);
    }

    struct DropProbe(Arc<AtomicBool>);
    impl Drop for DropProbe {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn unpolled_cancellation_drops_captures_without_constructing_work() {
        let called = Arc::new(AtomicBool::new(false));
        let observed = called.clone();
        let dropped = Arc::new(AtomicBool::new(false));
        let owned = DropProbe(dropped.clone());
        let future = task(move || async move {
            observed.store(true, Ordering::SeqCst);
            drop(owned);
        });
        drop(future);
        assert!(!called.load(Ordering::SeqCst));
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[test]
    fn cancellation_after_poll_drops_the_original_pending_work() {
        let dropped = Arc::new(AtomicBool::new(false));
        let owned = DropProbe(dropped.clone());
        let mut future = task(move || async move {
            let _owned = owned;
            std::future::pending::<()>().await;
        });
        assert!(poll_once(future.as_mut()).is_pending());
        assert!(!dropped.load(Ordering::SeqCst));
        drop(future);
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[test]
    fn success_and_error_results_are_preserved() {
        let mut success = task(|| async { Ok::<_, &'static str>(17) });
        assert_eq!(poll_once(success.as_mut()), Poll::Ready(Ok(17)));
        let mut error = task(|| async { Err::<usize, _>("fixed-error") });
        assert_eq!(poll_once(error.as_mut()), Poll::Ready(Err("fixed-error")));
    }
}
