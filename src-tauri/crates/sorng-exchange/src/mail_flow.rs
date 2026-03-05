// ─── Exchange Integration – mail flow (message trace, queues, delivery) ──────
use crate::client::ExchangeClient;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Message Trace (Exchange Online)
// ═══════════════════════════════════════════════════════════════════════════════

/// Run a message trace (Get-MessageTrace) – works for EXO via PS or REST.
pub async fn ps_message_trace(
    client: &ExchangeClient,
    req: &MessageTraceRequest,
) -> ExchangeResult<Vec<MessageTraceResult>> {
    let mut cmd = String::from("Get-MessageTrace");

    if let Some(ref s) = req.sender_address {
        cmd.push_str(&format!(" -SenderAddress '{}'", s.replace('\'', "''")));
    }
    if let Some(ref r) = req.recipient_address {
        cmd.push_str(&format!(" -RecipientAddress '{}'", r.replace('\'', "''")));
    }
    if let Some(ref mid) = req.message_id {
        cmd.push_str(&format!(" -MessageId '{}'", mid.replace('\'', "''")));
    }
    if let Some(ref start) = req.start_date {
        cmd.push_str(&format!(
            " -StartDate '{}'",
            start.format("%m/%d/%Y %H:%M:%S")
        ));
    }
    if let Some(ref end) = req.end_date {
        cmd.push_str(&format!(
            " -EndDate '{}'",
            end.format("%m/%d/%Y %H:%M:%S")
        ));
    }
    cmd.push_str(&format!(" -PageSize {}", req.page_size));
    if req.page > 0 {
        cmd.push_str(&format!(" -Page {}", req.page));
    }

    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Message Tracking (On-Premises)
// ═══════════════════════════════════════════════════════════════════════════════

/// Search message tracking logs (Get-MessageTrackingLog) – on-prem only.
pub async fn ps_message_tracking_log(
    client: &ExchangeClient,
    sender: Option<&str>,
    recipient: Option<&str>,
    start: Option<&str>,
    end: Option<&str>,
    server: Option<&str>,
    result_size: Option<i32>,
) -> ExchangeResult<Vec<MessageTraceResult>> {
    let mut cmd = String::from("Get-MessageTrackingLog");
    if let Some(s) = sender {
        cmd.push_str(&format!(" -Sender '{}'", s.replace('\'', "''")));
    }
    if let Some(r) = recipient {
        cmd.push_str(&format!(" -Recipients '{}'", r.replace('\'', "''")));
    }
    if let Some(s) = start {
        cmd.push_str(&format!(" -Start '{s}'"));
    }
    if let Some(e) = end {
        cmd.push_str(&format!(" -End '{e}'"));
    }
    if let Some(srv) = server {
        cmd.push_str(&format!(" -Server '{}'", srv.replace('\'', "''")));
    }
    let limit = result_size.unwrap_or(1000);
    cmd.push_str(&format!(" -ResultSize {limit}"));

    client.run_ps_json(&cmd).await
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mail Queue management (On-Premises – Get-Queue / Retry / Suspend / Resume)
// ═══════════════════════════════════════════════════════════════════════════════

/// List transport queues on a server.
pub async fn ps_list_queues(
    client: &ExchangeClient,
    server: Option<&str>,
) -> ExchangeResult<Vec<MailQueue>> {
    let cmd = match server {
        Some(s) => format!("Get-Queue -Server '{}'", s.replace('\'', "''")),
        None => "Get-Queue".to_string(),
    };
    client.run_ps_json(&cmd).await
}

/// Get a specific queue.
pub async fn ps_get_queue(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<MailQueue> {
    let cmd = format!(
        "Get-Queue -Identity '{}'",
        identity.replace('\'', "''")
    );
    client.run_ps_json(&cmd).await
}

/// Retry a queue.
pub async fn ps_retry_queue(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Retry-Queue -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Suspend a queue.
pub async fn ps_suspend_queue(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Suspend-Queue -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Resume a queue.
pub async fn ps_resume_queue(
    client: &ExchangeClient,
    identity: &str,
) -> ExchangeResult<String> {
    let cmd = format!(
        "Resume-Queue -Identity '{}' -Confirm:$false",
        identity.replace('\'', "''")
    );
    client.run_ps(&cmd).await
}

/// Get queue message count summary across all servers.
pub async fn ps_queue_summary(
    client: &ExchangeClient,
) -> ExchangeResult<Vec<MailQueue>> {
    client
        .run_ps_json("Get-Queue | Where-Object { $_.MessageCount -gt 0 }")
        .await
}
