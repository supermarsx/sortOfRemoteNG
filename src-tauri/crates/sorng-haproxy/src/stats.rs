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
    let mut name = None;
    let mut version = String::new();
    let mut release_date = None;
    let mut nbthread = None;
    let mut nbproc = None;
    let mut process_num = None;
    let mut pid: u32 = 0;
    let mut uptime = None;
    let mut uptime_sec = None;
    let mut mem_max_mb = None;
    let mut pool_alloc_mb = None;
    let mut pool_used_mb = None;
    let mut pool_failed = None;
    let mut ulimit_n = None;
    let mut maxsock = None;
    let mut maxconn = None;
    let mut hard_maxconn = None;
    let mut curr_conns = None;
    let mut cum_conns = None;
    let mut cum_req = None;
    let mut max_ssl_conns = None;
    let mut curr_ssl_conns = None;
    let mut cum_ssl_conns = None;
    let mut maxpipes = None;
    let mut pipes_used = None;
    let mut pipes_free = None;
    let mut conn_rate = None;
    let mut conn_rate_limit = None;
    let mut max_conn_rate = None;
    let mut sess_rate = None;
    let mut sess_rate_limit = None;
    let mut max_sess_rate = None;
    let mut ssl_rate = None;
    let mut ssl_rate_limit = None;
    let mut max_ssl_rate = None;
    let mut ssl_frontend_key_rate = None;
    let mut ssl_frontend_max_key_rate = None;
    let mut ssl_frontend_session_reuse = None;
    let mut ssl_backend_key_rate = None;
    let mut ssl_backend_max_key_rate = None;
    let mut ssl_cache_usage = None;
    let mut ssl_cache_misses = None;
    let mut compress_bps_in = None;
    let mut compress_bps_out = None;
    let mut compress_bps_rate_lim = None;
    let mut tasks = None;
    let mut run_queue = None;
    let mut idle_pct = None;
    let mut node = None;
    let mut description = None;

    for line in raw.lines() {
        let parts: Vec<&str> = line.splitn(2, ':').collect();
        if parts.len() != 2 {
            continue;
        }
        let key = parts[0].trim();
        let val = parts[1].trim();
        match key {
            "Name" => name = Some(val.to_string()),
            "Version" => version = val.to_string(),
            "Release_date" => release_date = Some(val.to_string()),
            "Nbthread" => nbthread = val.parse().ok(),
            "Nbproc" => nbproc = val.parse().ok(),
            "Process_num" => process_num = val.parse().ok(),
            "Pid" => pid = val.parse().unwrap_or(0),
            "Uptime" => uptime = Some(val.to_string()),
            "Uptime_sec" => uptime_sec = val.parse().ok(),
            "Memmax_MB" => mem_max_mb = val.parse().ok(),
            "PoolAlloc_MB" => pool_alloc_mb = val.parse().ok(),
            "PoolUsed_MB" => pool_used_mb = val.parse().ok(),
            "PoolFailed" => pool_failed = val.parse().ok(),
            "Ulimit-n" => ulimit_n = val.parse().ok(),
            "Maxsock" => maxsock = val.parse().ok(),
            "Maxconn" => maxconn = val.parse().ok(),
            "Hard_maxconn" => hard_maxconn = val.parse().ok(),
            "CurrConns" => curr_conns = val.parse().ok(),
            "CumConns" => cum_conns = val.parse().ok(),
            "CumReq" => cum_req = val.parse().ok(),
            "MaxSslConns" => max_ssl_conns = val.parse().ok(),
            "CurrSslConns" => curr_ssl_conns = val.parse().ok(),
            "CumSslConns" => cum_ssl_conns = val.parse().ok(),
            "Maxpipes" => maxpipes = val.parse().ok(),
            "PipesUsed" => pipes_used = val.parse().ok(),
            "PipesFree" => pipes_free = val.parse().ok(),
            "ConnRate" => conn_rate = val.parse().ok(),
            "ConnRateLimit" => conn_rate_limit = val.parse().ok(),
            "MaxConnRate" => max_conn_rate = val.parse().ok(),
            "SessRate" => sess_rate = val.parse().ok(),
            "SessRateLimit" => sess_rate_limit = val.parse().ok(),
            "MaxSessRate" => max_sess_rate = val.parse().ok(),
            "SslRate" => ssl_rate = val.parse().ok(),
            "SslRateLimit" => ssl_rate_limit = val.parse().ok(),
            "MaxSslRate" => max_ssl_rate = val.parse().ok(),
            "SslFrontendKeyRate" => ssl_frontend_key_rate = val.parse().ok(),
            "SslFrontendMaxKeyRate" => ssl_frontend_max_key_rate = val.parse().ok(),
            "SslFrontendSessionReuse_pct" => ssl_frontend_session_reuse = val.parse().ok(),
            "SslBackendKeyRate" => ssl_backend_key_rate = val.parse().ok(),
            "SslBackendMaxKeyRate" => ssl_backend_max_key_rate = val.parse().ok(),
            "SslCacheLookups" => ssl_cache_usage = val.parse().ok(),
            "SslCacheMisses" => ssl_cache_misses = val.parse().ok(),
            "CompressBpsIn" => compress_bps_in = val.parse().ok(),
            "CompressBpsOut" => compress_bps_out = val.parse().ok(),
            "CompressBpsRateLim" => compress_bps_rate_lim = val.parse().ok(),
            "Tasks" => tasks = val.parse().ok(),
            "Run_queue" => run_queue = val.parse().ok(),
            "Idle_pct" => idle_pct = val.parse().ok(),
            "Node" => node = Some(val.to_string()),
            "Description" => description = Some(val.to_string()),
            _ => {}
        }
    }
    HaproxyInfo {
        name,
        version,
        release_date,
        nbthread,
        nbproc,
        process_num,
        pid,
        uptime,
        uptime_sec,
        mem_max_mb,
        pool_alloc_mb,
        pool_used_mb,
        pool_failed,
        ulimit_n,
        maxsock,
        maxconn,
        hard_maxconn,
        curr_conns,
        cum_conns,
        cum_req,
        max_ssl_conns,
        curr_ssl_conns,
        cum_ssl_conns,
        maxpipes,
        pipes_used,
        pipes_free,
        conn_rate,
        conn_rate_limit,
        max_conn_rate,
        sess_rate,
        sess_rate_limit,
        max_sess_rate,
        ssl_rate,
        ssl_rate_limit,
        max_ssl_rate,
        ssl_frontend_key_rate,
        ssl_frontend_max_key_rate,
        ssl_frontend_session_reuse,
        ssl_backend_key_rate,
        ssl_backend_max_key_rate,
        ssl_cache_usage,
        ssl_cache_misses,
        compress_bps_in,
        compress_bps_out,
        compress_bps_rate_lim,
        tasks,
        run_queue,
        idle_pct,
        node,
        description,
    }
}
