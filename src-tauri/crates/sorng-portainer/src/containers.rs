// ── sorng-portainer/src/containers.rs ────────────────────────────────────────
//! Containers via Portainer's Docker Engine API proxy
//! (`/api/endpoints/{eid}/docker/containers/...`).

use crate::client::PortainerClient;
use crate::error::{PortainerError, PortainerResult};
use crate::types::{
    PortainerAuthMode, PortainerContainer, PortainerContainerPort, PortainerLogLine,
};
use reqwest::Method;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct RawPort {
    #[serde(rename = "IP")]
    ip: Option<String>,
    #[serde(rename = "PrivatePort", default)]
    private_port: u16,
    #[serde(rename = "PublicPort")]
    public_port: Option<u16>,
    #[serde(rename = "Type")]
    protocol: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawContainer {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Names", default)]
    names: Vec<String>,
    #[serde(rename = "Image", default)]
    image: String,
    #[serde(rename = "State", default)]
    state: String,
    #[serde(rename = "Status", default)]
    status: String,
    #[serde(rename = "Ports", default)]
    ports: Vec<RawPort>,
    #[serde(rename = "Created", default)]
    created: i64,
}

pub(crate) fn parse_containers(body: &[u8]) -> serde_json::Result<Vec<PortainerContainer>> {
    let raw: Vec<RawContainer> = serde_json::from_slice(body)?;
    Ok(raw
        .into_iter()
        .map(|c| PortainerContainer {
            id: c.id,
            names: c
                .names
                .into_iter()
                .map(|n| n.trim_start_matches('/').to_string())
                .collect(),
            image: c.image,
            state: c.state,
            status: c.status,
            ports: c
                .ports
                .into_iter()
                .map(|p| PortainerContainerPort {
                    ip: p.ip,
                    private_port: p.private_port,
                    public_port: p.public_port,
                    protocol: p.protocol,
                })
                .collect(),
            created: c.created,
        })
        .collect())
}

// ── Docker log stream demux ──────────────────────────────────────

fn stream_name(kind: u8) -> &'static str {
    match kind {
        0 => "stdin",
        1 => "stdout",
        _ => "stderr",
    }
}

/// Sniff whether the body looks like Docker's multiplexed stream: an 8-byte
/// header `[stream(0|1|2), 0, 0, 0, size:u32 BE]` whose size fits the body.
pub fn looks_multiplexed(body: &[u8]) -> bool {
    if body.len() < 8 {
        return false;
    }
    let kind = body[0];
    if kind > 2 || body[1] != 0 || body[2] != 0 || body[3] != 0 {
        return false;
    }
    let size = u32::from_be_bytes([body[4], body[5], body[6], body[7]]) as usize;
    size <= body.len() - 8
}

fn push_lines(out: &mut Vec<PortainerLogLine>, stream: &str, chunk: &[u8]) {
    let text = String::from_utf8_lossy(chunk);
    for line in text.split_inclusive('\n') {
        let line = line.trim_end_matches(['\n', '\r']);
        if line.is_empty() {
            continue;
        }
        out.push(PortainerLogLine {
            stream: stream.to_string(),
            text: line.to_string(),
        });
    }
}

/// Split a Docker `logs` body into lines. Multiplexed (non-TTY) bodies are
/// demuxed frame by frame; raw TTY output is reported as `stdout` lines.
pub fn demux_docker_logs(body: &[u8]) -> Vec<PortainerLogLine> {
    let mut out = Vec::new();
    if !looks_multiplexed(body) {
        push_lines(&mut out, "stdout", body);
        return out;
    }
    let mut pos = 0usize;
    while pos + 8 <= body.len() {
        let kind = body[pos];
        let size = u32::from_be_bytes([body[pos + 4], body[pos + 5], body[pos + 6], body[pos + 7]])
            as usize;
        let start = pos + 8;
        let end = start.saturating_add(size).min(body.len());
        if kind > 2 || body[pos + 1] != 0 || body[pos + 2] != 0 || body[pos + 3] != 0 {
            // Corrupt frame header — emit the rest raw rather than lose it.
            push_lines(&mut out, "stdout", &body[pos..]);
            break;
        }
        push_lines(&mut out, stream_name(kind), &body[start..end]);
        pos = end;
    }
    out
}

// ── Client methods ───────────────────────────────────────────────

impl PortainerClient {
    fn container_path(endpoint_id: u64, tail: &str) -> String {
        format!("/endpoints/{endpoint_id}/docker/containers{tail}")
    }

    fn map_status(&self, status: u16, body: &[u8]) -> PortainerError {
        let text = String::from_utf8_lossy(body);
        PortainerError::from_status(status, &text, self.auth_mode() == PortainerAuthMode::ApiKey)
    }

    /// `GET /api/endpoints/{eid}/docker/containers/json?all=…`
    pub async fn list_containers(
        &self,
        endpoint_id: u64,
        all: bool,
    ) -> PortainerResult<Vec<PortainerContainer>> {
        let path = Self::container_path(endpoint_id, &format!("/json?all={}", u8::from(all)));
        let (status, bytes) = self.send_raw(Method::GET, &path, None).await?;
        if !(200..300).contains(&status) {
            return Err(self.map_status(status, &bytes));
        }
        parse_containers(&bytes).map_err(|e| PortainerError::parse(format!("containers/json: {e}")))
    }

    async fn container_action(
        &self,
        endpoint_id: u64,
        container_id: &str,
        action: &str,
    ) -> PortainerResult<()> {
        let path = Self::container_path(endpoint_id, &format!("/{container_id}/{action}"));
        // 204 = done, 304 = already in the requested state.
        self.request_status(Method::POST, &path, None, &[204, 304])
            .await
    }

    pub async fn start_container(
        &self,
        endpoint_id: u64,
        container_id: &str,
    ) -> PortainerResult<()> {
        self.container_action(endpoint_id, container_id, "start")
            .await
    }

    pub async fn stop_container(
        &self,
        endpoint_id: u64,
        container_id: &str,
    ) -> PortainerResult<()> {
        self.container_action(endpoint_id, container_id, "stop")
            .await
    }

    pub async fn restart_container(
        &self,
        endpoint_id: u64,
        container_id: &str,
    ) -> PortainerResult<()> {
        self.container_action(endpoint_id, container_id, "restart")
            .await
    }

    /// `GET …/containers/{cid}/logs?stdout=1&stderr=1&tail=N&timestamps=1`
    pub async fn container_logs(
        &self,
        endpoint_id: u64,
        container_id: &str,
        tail: u32,
    ) -> PortainerResult<Vec<PortainerLogLine>> {
        let path = Self::container_path(
            endpoint_id,
            &format!("/{container_id}/logs?stdout=1&stderr=1&tail={tail}&timestamps=1"),
        );
        let (status, bytes) = self.send_raw(Method::GET, &path, None).await?;
        if !(200..300).contains(&status) {
            return Err(self.map_status(status, &bytes));
        }
        Ok(demux_docker_logs(&bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(kind: u8, payload: &[u8]) -> Vec<u8> {
        let mut v = vec![kind, 0, 0, 0];
        v.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        v.extend_from_slice(payload);
        v
    }

    #[test]
    fn demuxes_framed_stdout_and_stderr() {
        let mut body = frame(1, b"hello\nworld\n");
        body.extend(frame(2, b"oops\n"));
        let lines = demux_docker_logs(&body);
        assert_eq!(lines.len(), 3);
        assert_eq!(
            (lines[0].stream.as_str(), lines[0].text.as_str()),
            ("stdout", "hello")
        );
        assert_eq!(
            (lines[1].stream.as_str(), lines[1].text.as_str()),
            ("stdout", "world")
        );
        assert_eq!(
            (lines[2].stream.as_str(), lines[2].text.as_str()),
            ("stderr", "oops")
        );
    }

    #[test]
    fn raw_tty_output_is_stdout_lines() {
        let body = b"line one\r\nline two\n";
        let lines = demux_docker_logs(body);
        assert_eq!(lines.len(), 2);
        assert!(lines.iter().all(|l| l.stream == "stdout"));
        assert_eq!(lines[0].text, "line one");
    }

    #[test]
    fn sniffing_rejects_text_that_happens_to_start_low() {
        // A body starting with byte 1 but whose declared size exceeds the body
        // must not be treated as framed.
        let body = [1u8, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, b'x'];
        assert!(!looks_multiplexed(&body));
        assert!(!looks_multiplexed(b"2024-01-01 log"));
        assert!(!looks_multiplexed(b"short"));
        assert!(looks_multiplexed(&frame(1, b"ok")));
    }

    #[test]
    fn truncated_last_frame_is_kept() {
        let mut body = frame(1, b"complete\n");
        let mut partial = frame(2, b"partial-data");
        partial.truncate(partial.len() - 4);
        body.extend(partial);
        let lines = demux_docker_logs(&body);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[1].stream, "stderr");
        assert_eq!(lines[1].text, "partial-");
    }

    #[test]
    fn parses_containers_and_strips_name_slash() {
        let body = br#"[{"Id":"abc","Names":["/portainer"],"Image":"portainer/portainer-ce:lts","State":"running","Status":"Up 2 hours",
            "Ports":[{"IP":"0.0.0.0","PrivatePort":9000,"PublicPort":19000,"Type":"tcp"},{"PrivatePort":9443,"Type":"tcp"}],"Created":1700000000}]"#;
        let cs = parse_containers(body).unwrap();
        assert_eq!(cs[0].names, vec!["portainer"]);
        assert_eq!(cs[0].ports.len(), 2);
        assert_eq!(cs[0].ports[0].public_port, Some(19000));
        assert_eq!(cs[0].ports[1].public_port, None);
        assert_eq!(cs[0].created, 1_700_000_000);
    }
}
