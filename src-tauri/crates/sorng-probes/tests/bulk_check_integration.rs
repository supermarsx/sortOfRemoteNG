use sorng_probes::bulk::{
    cancel_run, check_all, CheckRequest, CompleteEvent, EmitProgress, ProgressEvent,
};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

struct TestEmitter {
    progress: Mutex<Vec<ProgressEvent>>,
    done: Mutex<Option<oneshot::Sender<CompleteEvent>>>,
}

impl EmitProgress for TestEmitter {
    fn emit_progress(&self, evt: &ProgressEvent) {
        self.progress.lock().unwrap().push(evt.clone());
    }
    fn emit_complete(&self, evt: &CompleteEvent) {
        if let Some(tx) = self.done.lock().unwrap().take() {
            let _ = tx.send(evt.clone());
        }
    }
}

#[tokio::test]
async fn runs_three_probes_end_to_end() {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            if let Ok((_s, _)) = l.accept().await {
                // keep accepting; connection dropped when _s drops
            }
        }
    });
    let (tx, rx) = oneshot::channel();
    let emitter = Arc::new(TestEmitter {
        progress: Mutex::new(Vec::new()),
        done: Mutex::new(Some(tx)),
    });
    let reqs = vec![
        CheckRequest {
            connection_id: "a".into(),
            host: "127.0.0.1".into(),
            port,
            protocol: "tcp".into(),
        },
        CheckRequest {
            connection_id: "b".into(),
            host: "127.0.0.1".into(),
            port,
            protocol: "tcp".into(),
        },
        CheckRequest {
            connection_id: "c".into(),
            host: "127.0.0.1".into(),
            port,
            protocol: "tcp".into(),
        },
    ];
    let run_id = check_all(emitter.clone(), reqs, 2, 1000).await;
    let evt = rx.await.unwrap();
    assert_eq!(evt.run_id, run_id);
    assert_eq!(evt.total, 3);
    assert_eq!(evt.completed, 3);
    assert!(!evt.cancelled);
    assert_eq!(emitter.progress.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn cancel_mid_run_drops_subsequent_work() {
    let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            if let Ok((s, _)) = l.accept().await {
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    drop(s);
                });
            }
        }
    });
    let (tx, rx) = oneshot::channel();
    let emitter = Arc::new(TestEmitter {
        progress: Mutex::new(Vec::new()),
        done: Mutex::new(Some(tx)),
    });
    let reqs: Vec<CheckRequest> = (0..5)
        .map(|i| CheckRequest {
            connection_id: format!("c{i}"),
            host: "127.0.0.1".into(),
            port,
            protocol: "ssh".into(),
        })
        .collect();
    let emitter_c = emitter.clone();
    let run = tokio::spawn(async move { check_all(emitter_c, reqs, 1, 500).await });

    tokio::time::sleep(std::time::Duration::from_millis(700)).await;
    let run_id_opt = emitter.progress.lock().unwrap().first().map(|p| p.run_id.clone());
    if let Some(id) = run_id_opt {
        let _ = cancel_run(&id);
    }
    let _ = run.await.unwrap();
    let evt = rx.await.unwrap();
    assert!(
        evt.cancelled || evt.completed < 5,
        "expected cancel to drop work (completed={}, cancelled={})",
        evt.completed,
        evt.cancelled
    );
}
