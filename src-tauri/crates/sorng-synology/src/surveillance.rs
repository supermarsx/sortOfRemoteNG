//! Surveillance Station — cameras, recordings, live view.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use crate::wire;
use serde::Deserialize;

/// `SYNO.SurveillanceStation.Info getinfo` (Surveillance Station Web API
/// guide, Info). The counts are reported to Surveillance-login users only.
#[derive(Deserialize)]
struct InfoWire {
    version: SurveillanceVersion,
    #[serde(rename = "cameraNumber")]
    camera_number: Option<u32>,
    #[serde(rename = "licenseNumber")]
    license_number: Option<u32>,
}

impl From<InfoWire> for SurveillanceInfo {
    fn from(info: InfoWire) -> Self {
        Self {
            version: info.version,
            camera_count: info.camera_number,
            license_count: info.license_number,
        }
    }
}

/// One `SYNO.SurveillanceStation.Camera List` row. Version 9 (the guide)
/// sends `ip` and the stream settings in `stream1`; version 7 (py-synologydsm-api)
/// sends `host`, `enabled`, `recStatus`, `resolution` and `fps` at the top level.
#[derive(Deserialize)]
struct CameraWire {
    id: u32,
    name: String,
    ip: Option<String>,
    // Decoded separately rather than as an alias of `ip`, so a row carrying
    // both names is not a duplicate-field error.
    host: Option<String>,
    port: u16,
    model: Option<String>,
    vendor: Option<String>,
    status: u32,
    enabled: Option<bool>,
    #[serde(rename = "recStatus")]
    rec_status: Option<i64>,
    resolution: Option<String>,
    fps: Option<u32>,
    snapshot_path: Option<String>,
    stream1: Option<CameraStreamWire>,
}

#[derive(Deserialize)]
struct CameraStreamWire {
    resolution: Option<String>,
    fps: Option<u32>,
}

impl From<CameraWire> for Camera {
    fn from(camera: CameraWire) -> Self {
        let (stream_resolution, stream_fps) = camera
            .stream1
            .map_or((None, None), |stream| (stream.resolution, stream.fps));
        Self {
            id: camera.id,
            name: camera.name,
            ip: camera.ip.or(camera.host),
            port: camera.port,
            model: camera.model,
            vendor: camera.vendor,
            status: camera.status,
            enabled: camera.enabled,
            recording: camera.rec_status.map(|status| status != 0),
            resolution: camera.resolution.or(stream_resolution),
            fps: camera.fps.or(stream_fps),
            stream_path: None,
            snapshot_path: camera.snapshot_path,
        }
    }
}

/// One `SYNO.SurveillanceStation.Recording List` row (guide, Recording List).
/// The guide's table has no start or stop time; they are kept when present.
#[derive(Deserialize)]
struct RecordingWire {
    #[serde(deserialize_with = "wire::string_or_number")]
    id: String,
    #[serde(rename = "cameraId")]
    camera_id: u32,
    #[serde(rename = "cameraName")]
    camera_name: Option<String>,
    #[serde(
        rename = "startTime",
        default,
        deserialize_with = "wire::opt_string_or_number"
    )]
    start_time: Option<String>,
    #[serde(
        rename = "stopTime",
        default,
        deserialize_with = "wire::opt_string_or_number"
    )]
    stop_time: Option<String>,
    #[serde(rename = "sizeByte", deserialize_with = "wire::u64_lenient")]
    size_byte: u64,
}

impl From<RecordingWire> for Recording {
    fn from(recording: RecordingWire) -> Self {
        Self {
            id: recording.id,
            camera_id: recording.camera_id,
            camera_name: recording.camera_name,
            start_time: recording.start_time,
            stop_time: recording.stop_time,
            file_size: recording.size_byte,
            event_type: None,
        }
    }
}

pub struct SurveillanceManager;

impl SurveillanceManager {
    /// Get Surveillance Station info (version, cameras, etc.).
    pub async fn get_info(client: &SynoClient) -> SynologyResult<SurveillanceInfo> {
        let v = client
            .best_version("SYNO.SurveillanceStation.Info", 8)
            .unwrap_or(1);
        let info: InfoWire = client
            .api_call("SYNO.SurveillanceStation.Info", v, "getinfo", &[])
            .await?;
        Ok(info.into())
    }

    /// List all cameras.
    pub async fn list_cameras(client: &SynoClient) -> SynologyResult<Vec<Camera>> {
        let v = client
            .best_version("SYNO.SurveillanceStation.Camera", 9)
            .unwrap_or(1);
        let cameras: Vec<CameraWire> = client
            .api_list(
                "SYNO.SurveillanceStation.Camera",
                v,
                "List",
                &[
                    ("basic", "true"),
                    ("streamInfo", "true"),
                    ("privilege", "true"),
                ],
                &["cameras"],
            )
            .await?;
        Ok(cameras.into_iter().map(Camera::from).collect())
    }

    /// Get camera details.
    pub async fn get_camera(client: &SynoClient, cam_id: &str) -> SynologyResult<Camera> {
        let v = client
            .best_version("SYNO.SurveillanceStation.Camera", 9)
            .unwrap_or(1);
        client
            .api_call(
                "SYNO.SurveillanceStation.Camera",
                v,
                "GetInfo",
                &[("cameraIds", cam_id)],
            )
            .await
    }

    /// Enable a camera.
    pub async fn enable_camera(client: &SynoClient, cam_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.SurveillanceStation.Camera", 9)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.SurveillanceStation.Camera",
                v,
                "Enable",
                &[("cameraIds", cam_id)],
            )
            .await
    }

    /// Disable a camera.
    pub async fn disable_camera(client: &SynoClient, cam_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.SurveillanceStation.Camera", 9)
            .unwrap_or(1);
        client
            .api_post_void(
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
        const RECORDING: &str = "SYNO.SurveillanceStation.Recording";
        let v = client.best_version(RECORDING, 6).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        // `cameraIds` is a string (a comma-separated id list).
        let camera_ids = wire::string_param(client, RECORDING, cam_id);
        let recordings: Vec<RecordingWire> = client
            .api_list(
                RECORDING,
                v,
                "List",
                &[
                    ("cameraIds", camera_ids.as_str()),
                    ("offset", &off),
                    ("limit", &lim),
                ],
                &["recordings"],
            )
            .await?;
        Ok(recordings.into_iter().map(Recording::from).collect())
    }

    /// Download a recording as raw bytes.
    pub async fn download_recording(
        client: &SynoClient,
        recording_id: &str,
    ) -> SynologyResult<Vec<u8>> {
        let v = client
            .best_version("SYNO.SurveillanceStation.Recording", 6)
            .unwrap_or(1);
        client
            .raw_download(
                "SYNO.SurveillanceStation.Recording",
                v,
                "Download",
                &[("id", recording_id)],
            )
            .await
    }

    /// Get a snapshot from a camera.
    pub async fn get_snapshot(client: &SynoClient, cam_id: &str) -> SynologyResult<Vec<u8>> {
        let v = client
            .best_version("SYNO.SurveillanceStation.Camera", 9)
            .unwrap_or(1);
        client
            .raw_download(
                "SYNO.SurveillanceStation.Camera",
                v,
                "GetSnapshot",
                &[("cameraId", cam_id)],
            )
            .await
    }

    /// Get live view streaming URL for a camera.
    pub async fn get_live_view_path(
        client: &SynoClient,
        cam_id: &str,
    ) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.SurveillanceStation.Camera", 9)
            .unwrap_or(1);
        client
            .api_call(
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
        let v = client
            .best_version("SYNO.SurveillanceStation.PTZ", 5)
            .unwrap_or(1);
        let sp = speed.to_string();
        client
            .api_post_void(
                "SYNO.SurveillanceStation.PTZ",
                v,
                "Move",
                &[
                    ("cameraId", cam_id),
                    ("direction", direction),
                    ("speed", &sp),
                ],
            )
            .await
    }

    /// Get home mode status.
    pub async fn get_home_mode(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.SurveillanceStation.HomeMode", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.SurveillanceStation.HomeMode", v, "GetInfo", &[])
            .await
    }

    /// Set home mode on/off.
    pub async fn set_home_mode(client: &SynoClient, on: bool) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.SurveillanceStation.HomeMode", 1)
            .unwrap_or(1);
        let val = if on { "true" } else { "false" };
        client
            .api_post_void(
                "SYNO.SurveillanceStation.HomeMode",
                v,
                "Switch",
                &[("on", val)],
            )
            .await
    }
}
