//! Streaming transport tests use only a synthetic loopback peer and new tempdirs.
use crate::{
    client::SynoClient,
    file_transfer::FileTransferContext,
    types::{ApiInfoEntry, SynologyConfig},
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

fn context(port: u16) -> FileTransferContext {
    let mut client = SynoClient::new(&SynologyConfig {
        host: "127.0.0.1".into(),
        port,
        username: "fixture".into(),
        password: String::new(),
        use_https: false,
        insecure: false,
        timeout_secs: 2,
        otp_code: None,
        device_token: None,
        access_token: None,
    })
    .unwrap();
    client.sid = Some("private-fixture-sid".into());
    client.syno_token = Some("private-fixture-token".into());
    for name in [
        "SYNO.FileStation.Upload",
        "SYNO.FileStation.Download",
        "SYNO.FileStation.Delete",
        "SYNO.FileStation.List",
        "SYNO.API.Auth",
    ] {
        client.api_info.insert(
            name.into(),
            ApiInfoEntry {
                path: "entry.cgi".into(),
                min_version: 1,
                max_version: 6,
                request_format: Some("JSON".into()),
            },
        );
    }
    FileTransferContext {
        client,
        active: Arc::new(AtomicBool::new(true)),
        cancelled: Arc::new(tokio::sync::Notify::new()),
    }
}

async fn peer(response: Vec<u8>) -> (u16, tokio::task::JoinHandle<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let total = loop {
            let mut block = [0u8; 64 * 1024];
            let n = socket.read(&mut block).await.unwrap();
            assert!(n > 0 && request.len() + n < 4 * 1024 * 1024);
            request.extend_from_slice(&block[..n]);
            if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = std::str::from_utf8(&request[..end]).unwrap();
                let length = head
                    .lines()
                    .find_map(|line| {
                        line.split_once(':')
                            .filter(|(key, _)| key.eq_ignore_ascii_case("content-length"))
                            .map(|(_, value)| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                break end + 4 + length;
            }
        };
        while request.len() < total {
            let mut block = [0u8; 64 * 1024];
            let n = socket.read(&mut block).await.unwrap();
            assert!(n > 0 && request.len() + n < 4 * 1024 * 1024);
            request.extend_from_slice(&block[..n]);
        }
        for chunk in response.chunks(8192) {
            socket.write_all(chunk).await.unwrap();
        }
        socket.shutdown().await.unwrap();
        request
    });
    (port, task)
}

#[tokio::test]
async fn revoked_stalled_download_cancels_send_and_body_waits_without_publishing_files() {
    for send_headers in [false, true] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let entered = Arc::new(tokio::sync::Notify::new());
        let ready = entered.clone();
        let peer = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut data = [0u8; 8192];
            let _ = socket.read(&mut data).await.unwrap();
            if send_headers {
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=fixture.bin\r\nContent-Length: 100\r\n\r\nfirst").await.unwrap();
            }
            ready.notify_one();
            std::future::pending::<()>().await;
        });
        let context = context(port);
        let active = context.active.clone();
        let cancelled = context.cancelled.clone();
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("fixture.bin");
        let selected = destination.clone();
        let transfer = tokio::spawn(async move {
            context
                .download_selected("/share/fixture.bin", &selected)
                .await
        });
        entered.notified().await;
        active.store(false, Ordering::Release);
        cancelled.notify_waiters();
        let error = tokio::time::timeout(Duration::from_secs(1), transfer)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(matches!(
            error.kind,
            crate::error::SynologyErrorKind::SessionExpired
        ));
        assert!(!destination.exists());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
        peer.abort();
    }
}
fn response(body: &[u8], attachment: bool) -> Vec<u8> {
    let header = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n", body.len(), if attachment { "Content-Disposition: attachment; filename=fixture.json\r\n" } else { "" });
    [header.as_bytes(), body].concat()
}
fn assert_private_post(request: &[u8]) -> (&str, &[u8]) {
    let end = request.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let header = std::str::from_utf8(&request[..end]).unwrap();
    let target = header.lines().next().unwrap();
    assert!(target.starts_with("POST /webapi/entry.cgi?"));
    for secret in [
        "private-fixture-sid",
        "private-fixture-token",
        "_sid",
        "SynoToken",
        "password",
    ] {
        assert!(!target.contains(secret));
    }
    (header, &request[end + 4..])
}

#[tokio::test]
async fn streaming_upload_is_authenticated_collision_safe_and_file_part_last() {
    let (port, peer) = peer(response(br#"{"success":true}"#, false)).await;
    let context = context(port);
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("fixture.bin");
    let data = vec![b'Q'; 2 * 1024 * 1024];
    tokio::fs::write(&source, &data).await.unwrap();
    let result = context
        .upload_selected(&source, "/share", None)
        .await
        .unwrap();
    assert_eq!(result.bytes, Some(data.len() as u64));
    let request = peer.await.unwrap();
    let (_, body) = assert_private_post(&request);
    let text = String::from_utf8_lossy(body);
    let file = text.find("name=\"file\"").unwrap();
    assert!(text.find("name=\"_sid\"").unwrap() < file);
    assert!(text.find("name=\"SynoToken\"").unwrap() < file);
    assert!(!text.contains("name=\"overwrite\""));
    assert!(!text[file..].contains("name=\"_sid\""));
    assert_eq!(text.matches('Q').count(), data.len());
    assert_eq!(tokio::fs::read(source).await.unwrap(), data);
}

#[tokio::test]
async fn streaming_json_attachment_is_saved_atomically_without_renderer_bytes() {
    let data = br#"{"success":false,"error":{"code":404},"this_is":"a user JSON file"}"#;
    let (port, peer) = peer(response(data, true)).await;
    let context = context(port);
    let directory = tempfile::tempdir().unwrap();
    let target = directory.path().join("result.json");
    let result = context
        .download_selected("/share/report.json", &target)
        .await
        .unwrap();
    assert_eq!(result.bytes, Some(data.len() as u64));
    assert_eq!(tokio::fs::read(target).await.unwrap(), data);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    let request = peer.await.unwrap();
    let (_, body) = assert_private_post(&request);
    let fields: std::collections::HashMap<_, _> =
        url::form_urlencoded::parse(body).into_owned().collect();
    assert_eq!(fields["_sid"], "private-fixture-sid");
    assert_eq!(fields["SynoToken"], "private-fixture-token");
    assert_eq!(fields["path"], "[\"/share/report.json\"]");
    assert_eq!(fields["mode"], "\"download\"");
}

#[tokio::test]
async fn existing_destination_and_api_errors_never_replace_user_files() {
    let directory = tempfile::tempdir().unwrap();
    let existing = directory.path().join("existing.txt");
    tokio::fs::write(&existing, b"keep existing").await.unwrap();
    assert!(context(9)
        .download_selected("/share/file", &existing)
        .await
        .is_err());
    assert_eq!(tokio::fs::read(&existing).await.unwrap(), b"keep existing");
    let (port, peer) = peer(response(
        br#"{"success":false,"error":{"code":119,"errors":["private-password"]}}"#,
        false,
    ))
    .await;
    let transfer = context(port);
    let error = transfer
        .download_selected("/share/file", &directory.path().join("new.json"))
        .await
        .unwrap_err();
    assert!(!error.to_string().contains("private-password"));
    assert!(matches!(
        error.kind,
        crate::error::SynologyErrorKind::SessionExpired
    ));
    assert!(!transfer.active.load(Ordering::Acquire));
    peer.await.unwrap();
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn truncated_download_removes_only_its_temporary_file() {
    let raw = b"HTTP/1.1 200 OK\r\nContent-Length: 999\r\nContent-Disposition: attachment\r\nConnection: close\r\n\r\nshort".to_vec();
    let (port, peer) = peer(raw).await;
    let directory = tempfile::tempdir().unwrap();
    assert!(context(port)
        .download_selected("/share/file", &directory.path().join("new.bin"))
        .await
        .is_err());
    peer.await.unwrap();
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn legacy_download_still_sends_sid_and_accepts_json_attachments() {
    let body = br#"{"regular":"JSON"}"#;
    let (port, peer) = peer(response(body, true)).await;
    let data = context(port)
        .client
        .raw_download(
            "SYNO.FileStation.Download",
            2,
            "download",
            &[("path", "/share/file.json"), ("mode", "download")],
        )
        .await
        .unwrap();
    assert_eq!(data, body);
    let request = peer.await.unwrap();
    let (_, form) = assert_private_post(&request);
    let form = String::from_utf8_lossy(form);
    assert!(form.contains("_sid=private-fixture-sid"));
    assert!(form.contains("SynoToken=private-fixture-token"));
}

#[tokio::test]
async fn snapshot_transport_is_bounded_and_preview_accepts_only_image_signatures() {
    use base64::Engine;
    for data in [
        vec![0x89, b'P', b'N', b'G', 13, 10, 26, 10, 0],
        vec![0xff, 0xd8, 0xff, 0],
    ] {
        let (port, server) = peer(response(&data, true)).await;
        let bytes = context(port)
            .client
            .raw_download_bounded(
                "SYNO.FileStation.Download",
                2,
                "download",
                &[],
                3 * 1024 * 1024,
            )
            .await
            .unwrap();
        let preview = crate::scoped_files::camera_snapshot(bytes).unwrap();
        assert!(preview.mime_type == "image/png" || preview.mime_type == "image/jpeg");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(preview.data_base64)
                .unwrap(),
            data
        );
        assert_private_post(&server.await.unwrap());
    }
    assert!(
        crate::scoped_files::camera_snapshot(b"<script>not an image</script>".to_vec()).is_err()
    );
    assert!(crate::scoped_files::camera_snapshot(vec![0xff; 3 * 1024 * 1024 + 1]).is_err());
    // Exercise the actual streaming read cap with a small synthetic limit.
    let (port, server) = peer(response(&[0xff; 65], true)).await;
    assert!(context(port)
        .client
        .raw_download_bounded("SYNO.FileStation.Download", 2, "download", &[], 64)
        .await
        .is_err());
    server.await.unwrap();
}

#[tokio::test]
async fn redirects_and_discovered_external_api_paths_never_receive_credentials() {
    let untrusted = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let location = format!(
        "http://127.0.0.1:{}/collect",
        untrusted.local_addr().unwrap().port()
    );
    let raw = format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes();
    let (port, peer) = peer(raw).await;
    let mut context = context(port);
    let error = context
        .client
        .api_post::<serde_json::Value>(
            "SYNO.API.Auth",
            6,
            "login",
            &[("passwd", "private-password")],
        )
        .await
        .unwrap_err();
    assert!(!error.to_string().contains("private-password"));
    assert!(!error.to_string().contains(&location));
    peer.await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(50), untrusted.accept())
            .await
            .is_err()
    );
    for path in [
        "https://evil.test/entry.cgi",
        "../entry.cgi",
        "entry.cgi?password=secret",
        "/entry.cgi",
        "a\\entry.cgi",
    ] {
        context
            .client
            .api_info
            .get_mut("SYNO.API.Auth")
            .unwrap()
            .path = path.into();
        assert!(context
            .client
            .resolve_url("SYNO.API.Auth", 6, "login")
            .is_err());
    }
    context.active.store(false, Ordering::Release);
}

#[tokio::test]
async fn legacy_upload_has_authenticated_body_with_file_last() {
    let (port, peer) = peer(response(br#"{"success":true}"#, false)).await;
    crate::file_station::FileStationManager::upload(
        &context(port).client,
        "/share",
        "fixture.txt",
        b"small fixture".to_vec(),
        false,
    )
    .await
    .unwrap();
    let request = peer.await.unwrap();
    let (_, body) = assert_private_post(&request);
    let text = String::from_utf8_lossy(body);
    let file = text.find("name=\"file\"").unwrap();
    assert!(text.find("name=\"_sid\"").unwrap() < file);
    assert!(text.find("name=\"SynoToken\"").unwrap() < file);
}

#[tokio::test]
async fn legacy_delete_waits_for_blocking_api_and_json_escapes_paths() {
    let (port, peer) = peer(response(br#"{"success":true}"#, false)).await;
    crate::file_station::FileStationManager::delete(
        &context(port).client,
        &["/share/quoted\"file.txt"],
        true,
    )
    .await
    .unwrap();
    let request = peer.await.unwrap();
    let (header, body) = assert_private_post(&request);
    assert!(header.lines().next().unwrap().contains("method=delete"));
    let fields: std::collections::HashMap<_, _> =
        url::form_urlencoded::parse(body).into_owned().collect();
    assert_eq!(
        serde_json::from_str::<Vec<String>>(&fields["path"]).unwrap(),
        ["/share/quoted\"file.txt"]
    );
}

#[tokio::test]
async fn legacy_shared_folder_result_consumes_shares_not_files() {
    let (port, peer) = peer(response(br#"{"success":true,"data":{"shares":[{"name":"share","path":"/share","isdir":true}],"offset":0,"total":1}}"#, false)).await;
    let data = crate::file_station::FileStationManager::list_shared_folders(&context(port).client)
        .await
        .unwrap();
    assert_eq!(data.files[0].path, "/share");
    peer.await.unwrap();
}
