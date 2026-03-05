// ── haproxy stats management ─────────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct StatsManager;

impl StatsManager {
    pub async fn get_info(client: &HaproxyClient) -> HaproxyResult<HaproxyInfo> {
        let raw = client.show_info().await?;
        Ok(parse_info(&raw))
    }

    pub async fn get_csv(client: &HaproxyClient) -> HaproxyResult<String> {
        if client.config.stats_url.is_some() {
            client.stats_http_csv().await
        } else {
            client.show_stat().await
        }
    }
}

fn parse_info(raw: &str) -> HaproxyInfo {
    let mut info = HaproxyInfo::default();
    for line in raw.lines() {
        let parts: Vec<&str> = line.splitn(2, ':').collect();
        if parts.len() != 2 { continue; }
        let key = parts[0].trim();
        let val = parts[1].trim();
        match key {
            "Name" => info.name = Some(val.to_string()),
            "Version" => info.version = Some(val.to_string()),
            "Release_date" => info.release_date = Some(val.to_string()),
            "Nbthread" => info.nbthread = val.parse().ok(),
            "Nbproc" => info.nbproc = val.parse().ok(),
            "Process_num" => info.process_num = val.parse().ok(),
            "Pid" => info.pid = val.parse().ok(),
            "Uptime" => info.uptime = Some(val.to_string()),
            "Uptime_sec" => info.uptime_sec = val.parse().ok(),
            "Memmax_MB" => info.memmax_mb = val.parse().ok(),
            "PoolAlloc_MB" => info.pool_alloc_mb = val.parse().ok(),
            "PoolUsed_MB" => info.pool_used_mb = val.parse().ok(),
            "PoolFailed" => info.pool_failed = val.parse().ok(),
            "Ulimit-n" => info.ulimit_n = val.parse().ok(),
            "Maxsock" => info.maxsock = val.parse().ok(),
            "Maxconn" => info.maxconn = val.parse().ok(),
            "Hard_maxconn" => info.hard_maxconn = val.parse().ok(),
            "CurrConns" => info.curr_conns = val.parse().ok(),
            "CumConns" => info.cum_conns = val.parse().ok(),
            "CumReq" => info.cum_req = val.parse().ok(),
            "MaxSslConns" => info.max_ssl_conns = val.parse().ok(),
            "CurrSslConns" => info.curr_ssl_conns = val.parse().ok(),
            "CumSslConns" => info.cum_ssl_conns = val.parse().ok(),
            "Maxpipes" => info.maxpipes = val.parse().ok(),
            "PipesUsed" => info.pipes_used = val.parse().ok(),
            "PipesFree" => info.pipes_free = val.parse().ok(),
            "ConnRate" => info.conn_rate = val.parse().ok(),
            "ConnRateLimit" => info.conn_rate_limit = val.parse().ok(),
            "MaxConnRate" => info.max_conn_rate = val.parse().ok(),
            "SessRate" => info.sess_rate = val.parse().ok(),
            "SessRateLimit" => info.sess_rate_limit = val.parse().ok(),
            "MaxSessRate" => info.max_sess_rate = val.parse().ok(),
            "SslRate" => info.ssl_rate = val.parse().ok(),
            "SslRateLimit" => info.ssl_rate_limit = val.parse().ok(),
            "MaxSslRate" => info.max_ssl_rate = val.parse().ok(),
            "SslFrontendKeyRate" => info.ssl_frontend_key_rate = val.parse().ok(),
            "SslFrontendMaxKeyRate" => info.ssl_frontend_max_key_rate = val.parse().ok(),
            "SslFrontendSessionReuse_pct" => info.ssl_frontend_session_reuse_pct = val.parse().ok(),
            "SslBackendKeyRate" => info.ssl_backend_key_rate = val.parse().ok(),
            "SslBackendMaxKeyRate" => info.ssl_backend_max_key_rate = val.parse().ok(),
            "SslCacheLookups" => info.ssl_cache_lookups = val.parse().ok(),
            "SslCacheMisses" => info.ssl_cache_misses = val.parse().ok(),
            "CompressBpsIn" => info.compress_bps_in = val.parse().ok(),
            "CompressBpsOut" => info.compress_bps_out = val.parse().ok(),
            "CompressBpsRateLim" => info.compress_bps_rate_lim = val.parse().ok(),
            "Tasks" => info.tasks = val.parse().ok(),
            "Run_queue" => info.run_queue = val.parse().ok(),
            "Idle_pct" => info.idle_pct = val.parse().ok(),
            "Node" => info.node = Some(val.to_string()),
            "Description" => info.description = Some(val.to_string()),
            _ => {}
        }
    }
    info
}
