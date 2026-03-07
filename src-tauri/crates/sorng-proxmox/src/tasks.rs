//! Task monitoring via the Proxmox VE REST API.

use crate::client::PveClient;
use crate::error::ProxmoxResult;
use crate::types::*;

pub struct TaskManager<'a> {
    client: &'a PveClient,
}

impl<'a> TaskManager<'a> {
    pub fn new(client: &'a PveClient) -> Self { Self { client } }

    /// List recent tasks on a node.
    pub async fn list_tasks(
        &self,
        node: &str,
        start: Option<u64>,
        limit: Option<u64>,
        vmid: Option<u64>,
        type_filter: Option<&str>,
        status_filter: Option<&str>,
    ) -> ProxmoxResult<Vec<TaskSummary>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(s) = start { params.push(("start", s.to_string())); }
        if let Some(l) = limit { params.push(("limit", l.to_string())); }
        if let Some(id) = vmid { params.push(("vmid", id.to_string())); }
        if let Some(t) = type_filter { params.push(("typefilter", t.to_string())); }
        if let Some(s) = status_filter { params.push(("statusfilter", s.to_string())); }
        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
        let path = format!("/api2/json/nodes/{node}/tasks");
        if borrowed.is_empty() {
            self.client.get(&path).await
        } else {
            self.client.get_with_params(&path, &borrowed).await
        }
    }

    /// Get task status by UPID.
    pub async fn get_task_status(&self, node: &str, upid: &str) -> ProxmoxResult<TaskStatus> {
        let upid_encoded = urlencoding_encode(upid);
        let path = format!("/api2/json/nodes/{node}/tasks/{upid_encoded}/status");
        self.client.get(&path).await
    }

    /// Get task log lines.
    pub async fn get_task_log(
        &self,
        node: &str,
        upid: &str,
        start: Option<u64>,
        limit: Option<u64>,
    ) -> ProxmoxResult<Vec<TaskLogLine>> {
        let upid_encoded = urlencoding_encode(upid);
        let path = format!("/api2/json/nodes/{node}/tasks/{upid_encoded}/log");
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(s) = start { params.push(("start", s.to_string())); }
        if let Some(l) = limit { params.push(("limit", l.to_string())); }
        let borrowed: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
        if borrowed.is_empty() {
            self.client.get(&path).await
        } else {
            self.client.get_with_params(&path, &borrowed).await
        }
    }

    /// Stop / cancel a running task.
    pub async fn stop_task(&self, node: &str, upid: &str) -> ProxmoxResult<()> {
        let upid_encoded = urlencoding_encode(upid);
        let path = format!("/api2/json/nodes/{node}/tasks/{upid_encoded}");
        self.client.delete(&path).await?;
        Ok(())
    }
}

/// Simple URL encoding for UPID strings (colons, etc.).
fn urlencoding_encode(input: &str) -> String {
    input.replace(':', "%3A")
         .replace('/', "%2F")
         .replace('+', "%2B")
         .replace(' ', "%20")
}
