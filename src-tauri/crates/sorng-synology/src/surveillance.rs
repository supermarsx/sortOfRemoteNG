//! Surveillance Station — cameras, recordings, live view.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct SurveillanceManager;

impl SurveillanceManager {
    /// Get Surveillance Station info (version, cameras, etc.).
    pub async fn get_info(client: &SynoClient) -> SynologyResult<SurveillanceInfo> {
        let v = client.best_version("SYNO.SurveillanceStation.Info", 8).unwrap_or(1);
        client.api_call("SYNO.SurveillanceStation.Info", v, "getinfo", &[]).await
    }

    /// List all cameras.
    pub async fn list_cameras(client: &SynoClient) -> SynologyResult<Vec<Camera>> {
        let v = client.best_version("SYNO.SurveillanceStation.Camera", 9).unwrap_or(1);
        client.api_call(
            "SYNO.SurveillanceStation.Camera",
            v,
            "List",
            &[("basic", "true"), ("streamInfo", "true"), ("privilege", "true")],
        )
        .await
    }

    /// Get camera details.
    pub async fn get_camera(client: &SynoClient, cam_id: &str) -> SynologyResult<Camera> {
        let v = client.best_version("SYNO.SurveillanceStation.Camera", 9).unwrap_or(1);
        client.api_call(
            "SYNO.SurveillanceStation.Camera",
            v,
            "GetInfo",
            &[("cameraIds", cam_id)],
        )
        .await
    }

    /// Enable a camera.
    pub async fn enable_camera(client: &SynoClient, cam_id: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.SurveillanceStation.Camera", 9).unwrap_or(1);
        client.api_post_void(
            "SYNO.SurveillanceStation.Camera",
            v,
            "Enable",
            &[("cameraIds", cam_id)],
        )
        .await
    }

    /// Disable a camera.
    pub async fn disable_camera(client: &SynoClient, cam_id: &str) -> SynologyResult<()> {
        let v = client.best_version("SYNO.SurveillanceStation.Camera", 9).unwrap_or(1);
        client.api_post_void(
            "SYNO.SurveillanceStation.Camera",
            v,
            "Disable",
            &[("cameraIds", cam_id)],
        )
        .await
    }

    /// List recordings for a camera.
    pub async fn list_recordings(
        client: &SynoClient,
        cam_id: &str,
        offset: u64,
        limit: u64,
    ) -> SynologyResult<Vec<Recording>> {
        let v = client.best_version("SYNO.SurveillanceStation.Recording", 6).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        client.api_call(
            "SYNO.SurveillanceStation.Recording",
            v,
            "List",
            &[
                ("cameraIds", cam_id),
                ("offset", &off),
                ("limit", &lim),
            ],
        )
        .await
    }

    /// Download a recording as raw bytes.
    pub async fn download_recording(
        client: &SynoClient,
        recording_id: &str,
    ) -> SynologyResult<Vec<u8>> {
        let v = client.best_version("SYNO.SurveillanceStation.Recording", 6).unwrap_or(1);
        client.raw_download(
            "SYNO.SurveillanceStation.Recording",
            v,
            "Download",
            &[("id", recording_id)],
        ).await
    }

    /// Get a snapshot from a camera.
    pub async fn get_snapshot(client: &SynoClient, cam_id: &str) -> SynologyResult<Vec<u8>> {
        let v = client.best_version("SYNO.SurveillanceStation.Camera", 9).unwrap_or(1);
        client.raw_download(
            "SYNO.SurveillanceStation.Camera",
            v,
            "GetSnapshot",
            &[("cameraId", cam_id)],
        ).await
    }

    /// Get live view streaming URL for a camera.
    pub async fn get_live_view_path(
        client: &SynoClient,
        cam_id: &str,
    ) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.SurveillanceStation.Camera", 9).unwrap_or(1);
        client.api_call(
            "SYNO.SurveillanceStation.Camera",
            v,
            "GetLiveViewPath",
            &[("idList", cam_id)],
        )
        .await
    }

    /// Trigger PTZ action.
    pub async fn ptz_move(
        client: &SynoClient,
        cam_id: &str,
        direction: &str,
        speed: u32,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.SurveillanceStation.PTZ", 5).unwrap_or(1);
        let sp = speed.to_string();
        client.api_post_void(
            "SYNO.SurveillanceStation.PTZ",
            v,
            "Move",
            &[("cameraId", cam_id), ("direction", direction), ("speed", &sp)],
        )
        .await
    }

    /// Get home mode status.
    pub async fn get_home_mode(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.SurveillanceStation.HomeMode", 1).unwrap_or(1);
        client.api_call("SYNO.SurveillanceStation.HomeMode", v, "GetInfo", &[]).await
    }

    /// Set home mode on/off.
    pub async fn set_home_mode(client: &SynoClient, on: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.SurveillanceStation.HomeMode", 1).unwrap_or(1);
        let val = if on { "true" } else { "false" };
        client.api_post_void(
            "SYNO.SurveillanceStation.HomeMode",
            v,
            "Switch",
            &[("on", val)],
        )
        .await
    }
}
