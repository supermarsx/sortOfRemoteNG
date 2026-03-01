//! Windows Media Foundation H.264 decoder with DXVA2 hardware acceleration.
//!
//! Uses `CLSID_CMSH264DecoderMFT` with `CODECAPI_AVLowLatencyMode` for
//! real-time RDP decoding.  Falls back to software decode when GPU
//! hardware acceleration is unavailable.

use std::ptr;
use std::sync::Once;

use windows::core::{GUID, IUnknown, Interface as _};
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

use super::yuv_convert;
use super::{DecodedFrame, FrameBufferPool, H264Decoder, H264Error};

static MF_INIT: Once = Once::new();
static MF_INIT_ERROR: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn ensure_mf_init() -> Result<(), H264Error> {
    MF_INIT.call_once(|| unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        // CO_E_ALREADYINITIALIZED (0x800401F0) is OK — someone else initialized COM
        if hr.is_err() && hr.0 as u32 != 0x800401F0 {
            let _ = MF_INIT_ERROR.set(format!("CoInitializeEx: HRESULT 0x{:08X}", hr.0 as u32));
            return;
        }
        if let Err(e) = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) {
            let _ = MF_INIT_ERROR.set(format!("MFStartup: {e}"));
        }
    });
    if let Some(err) = MF_INIT_ERROR.get() {
        Err(H264Error::InitFailed(err.clone()))
    } else {
        Ok(())
    }
}

/// CLSID for the Microsoft H.264 decoder MFT.
#[allow(non_upper_case_globals)]
const CLSID_CMSH264DecoderMFT: GUID = GUID::from_u128(0x62CE7E72_4C71_4d20_B15D_452831A87D9D);

pub struct MfH264Decoder {
    transform: IMFTransform,
    width: u32,
    height: u32,
    output_subtype: GUID,
    hardware: bool,
    output_stride: u32,
    /// Cached output stream info — avoids re-querying the MFT on every
    /// `ProcessOutput` call.  Refreshed on stream-change events.
    cached_output_info: Option<MFT_OUTPUT_STREAM_INFO>,
    /// Reusable RGBA buffer pool — avoids per-frame heap allocation.
    pool: FrameBufferPool,
}

// SAFETY: IMFTransform is a COM object that we only use from the RDP session thread.
// The MFT was created with COINIT_MULTITHREADED and is safe to access from one thread.
unsafe impl Send for MfH264Decoder {}

impl MfH264Decoder {
    pub fn new() -> Result<Self, H264Error> {
        ensure_mf_init()?;

        unsafe {
            // Create the H.264 decoder MFT
            let transform: IMFTransform = CoCreateInstance(
                &CLSID_CMSH264DecoderMFT,
                None,
                CLSCTX_INPROC_SERVER,
            )
            .map_err(|e| H264Error::InitFailed(format!("CoCreateInstance H264 MFT: {e}")))?;

            // Try to enable DXVA2 hardware acceleration
            let hardware = Self::try_enable_hardware(&transform);
            if hardware {
                log::info!("MF H264: DXVA2 hardware acceleration enabled");
            } else {
                log::info!("MF H264: using software decode");
            }

            // Enable low-latency mode for real-time decode
            Self::set_low_latency(&transform);

            // Set input type: H.264
            let input_type: IMFMediaType = MFCreateMediaType()
                .map_err(|e| H264Error::InitFailed(format!("MFCreateMediaType input: {e}")))?;
            input_type
                .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                .map_err(|e| H264Error::InitFailed(format!("input major type: {e}")))?;
            input_type
                .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)
                .map_err(|e| H264Error::InitFailed(format!("input subtype: {e}")))?;
            transform
                .SetInputType(0, &input_type, 0)
                .map_err(|e| H264Error::InitFailed(format!("SetInputType: {e}")))?;

            // Negotiate output type: prefer NV12 (hardware), accept I420/IYUV
            let (output_subtype, output_idx) = Self::negotiate_output_type(&transform)?;

            let output_type = transform
                .GetOutputAvailableType(0, output_idx)
                .map_err(|e| H264Error::InitFailed(format!("GetOutputAvailableType: {e}")))?;
            transform
                .SetOutputType(0, &output_type, 0)
                .map_err(|e| H264Error::InitFailed(format!("SetOutputType: {e}")))?;

            // Signal streaming start
            let _ = transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            let _ = transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
            let _ = transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);

            Ok(Self {
                transform,
                width: 0,
                height: 0,
                output_subtype,
                hardware,
                output_stride: 0,
                cached_output_info: None,
                pool: FrameBufferPool::new(4),
            })
        }
    }

    unsafe fn try_enable_hardware(transform: &IMFTransform) -> bool {
        // Create D3D11 device
        let mut device: Option<ID3D11Device> = None;
        let hr = D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            None,
        );
        let device = match (hr, device) {
            (Ok(_), Some(d)) => d,
            _ => return false,
        };

        // Enable multi-threaded protection
        if let Ok(mt) = device.cast::<ID3D11Multithread>() {
            let _ = mt.SetMultithreadProtected(true);
        }

        // Create DXGI device manager
        let mut reset_token = 0u32;
        let mut manager: Option<IMFDXGIDeviceManager> = None;
        if MFCreateDXGIDeviceManager(&mut reset_token, &mut manager).is_err() {
            return false;
        }
        let manager = match manager {
            Some(m) => m,
            None => return false,
        };

        if manager.ResetDevice(&device, reset_token).is_err() {
            return false;
        }

        // Set the D3D manager on the MFT
        let manager_unk: IUnknown = manager.cast().unwrap();
        if transform
            .ProcessMessage(
                MFT_MESSAGE_SET_D3D_MANAGER,
                std::mem::transmute::<*mut std::ffi::c_void, usize>(
                    manager_unk.into_raw(),
                ),
            )
            .is_err()
        {
            return false;
        }

        true
    }

    unsafe fn set_low_latency(transform: &IMFTransform) {
        if let Ok(attrs) = transform.GetAttributes() {
            let _ = attrs.SetUINT32(&MF_LOW_LATENCY, 1);
        }
    }

    unsafe fn negotiate_output_type(
        transform: &IMFTransform,
    ) -> Result<(GUID, u32), H264Error> {
        // Iterate available output types, prefer NV12 > I420 > IYUV
        let preferred = [MFVideoFormat_NV12, MFVideoFormat_IYUV, MFVideoFormat_I420];

        for idx in 0..32u32 {
            match transform.GetOutputAvailableType(0, idx) {
                Ok(mt) => {
                    if let Ok(subtype) = mt.GetGUID(&MF_MT_SUBTYPE) {
                        for &pref in &preferred {
                            if subtype == pref {
                                return Ok((pref, idx));
                            }
                        }
                    }
                }
                Err(_) => break,
            }
        }

        // Fallback: just take the first available
        Err(H264Error::InitFailed(
            "No supported output type (NV12/I420/IYUV) from MFT".into(),
        ))
    }

    unsafe fn create_input_sample(nal_data: &[u8]) -> Result<IMFSample, H264Error> {
        let buffer: IMFMediaBuffer = MFCreateMemoryBuffer(nal_data.len() as u32)
            .map_err(|e| H264Error::DecodeFailed(format!("MFCreateMemoryBuffer: {e}")))?;

        let mut buf_ptr: *mut u8 = ptr::null_mut();
        buffer
            .Lock(&mut buf_ptr, None, None)
            .map_err(|e| H264Error::DecodeFailed(format!("buffer Lock: {e}")))?;
        ptr::copy_nonoverlapping(nal_data.as_ptr(), buf_ptr, nal_data.len());
        buffer
            .Unlock()
            .map_err(|e| H264Error::DecodeFailed(format!("buffer Unlock: {e}")))?;
        buffer
            .SetCurrentLength(nal_data.len() as u32)
            .map_err(|e| H264Error::DecodeFailed(format!("SetCurrentLength: {e}")))?;

        let sample: IMFSample = MFCreateSample()
            .map_err(|e| H264Error::DecodeFailed(format!("MFCreateSample: {e}")))?;
        sample
            .AddBuffer(&buffer)
            .map_err(|e| H264Error::DecodeFailed(format!("AddBuffer: {e}")))?;

        Ok(sample)
    }

    fn refresh_output_format(&mut self) -> Result<(), H264Error> {
        unsafe {
            // Re-negotiate output type after stream change
            if let Ok((subtype, idx)) = Self::negotiate_output_type(&self.transform) {
                if let Ok(mt) = self.transform.GetOutputAvailableType(0, idx) {
                    let _ = self.transform.SetOutputType(0, &mt, 0);
                    self.output_subtype = subtype;

                    // Extract dimensions
                    if let Ok(packed) = mt.GetUINT64(&MF_MT_FRAME_SIZE) {
                        self.width = (packed >> 32) as u32;
                        self.height = packed as u32;
                    }

                    // Extract stride
                    if let Ok(stride) = mt.GetUINT32(&MF_MT_DEFAULT_STRIDE) {
                        self.output_stride = stride;
                    } else {
                        self.output_stride = self.width;
                    }
                }
            }
        }
        Ok(())
    }

    fn pull_output_frames(&mut self) -> Result<Vec<DecodedFrame>, H264Error> {
        let mut frames = Vec::new();

        unsafe {
            loop {
                // Use cached output stream info to avoid a COM call per iteration.
                let output_info = match self.cached_output_info {
                    Some(info) => info,
                    None => {
                        let info = self.transform.GetOutputStreamInfo(0).unwrap_or_default();
                        self.cached_output_info = Some(info);
                        info
                    }
                };
                let mft_provides_samples = (output_info.dwFlags
                    & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32
                        | MFT_OUTPUT_STREAM_LAZY_READ.0 as u32))
                    != 0;

                let mut output_buffers = [MFT_OUTPUT_DATA_BUFFER::default()];

                if !mft_provides_samples {
                    // We must allocate the output sample
                    let buf_size = if output_info.cbSize > 0 {
                        output_info.cbSize
                    } else {
                        // Estimate: NV12 = w*h*1.5, I420 = w*h*1.5
                        let pixels = if self.width > 0 && self.height > 0 {
                            self.width * self.height
                        } else {
                            1920 * 1088 // safe default
                        };
                        pixels * 3 / 2
                    };
                    let buffer: IMFMediaBuffer = MFCreateMemoryBuffer(buf_size)
                        .map_err(|e| {
                            H264Error::DecodeFailed(format!("output MFCreateMemoryBuffer: {e}"))
                        })?;
                    let sample: IMFSample =
                        MFCreateSample().map_err(|e| {
                            H264Error::DecodeFailed(format!("output MFCreateSample: {e}"))
                        })?;
                    sample.AddBuffer(&buffer).map_err(|e| {
                        H264Error::DecodeFailed(format!("output AddBuffer: {e}"))
                    })?;
                    output_buffers[0].pSample = std::mem::ManuallyDrop::new(Some(sample));
                }

                let mut status: u32 = 0;
                let hr = self
                    .transform
                    .ProcessOutput(0, &mut output_buffers, &mut status);

                match hr {
                    Ok(()) => {
                        if let Some(ref sample) = *output_buffers[0].pSample {
                            if let Some(frame) = self.extract_frame(sample)? {
                                frames.push(frame);
                            }
                        }
                    }
                    Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => {
                        break;
                    }
                    Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                        // Output format changed — invalidate cached info.
                        self.cached_output_info = None;
                        self.refresh_output_format()?;
                        continue;
                    }
                    Err(e) => {
                        log::warn!("MF ProcessOutput error: {e}");
                        break;
                    }
                }
            }
        }

        Ok(frames)
    }

    unsafe fn extract_frame(
        &mut self,
        sample: &IMFSample,
    ) -> Result<Option<DecodedFrame>, H264Error> {
        let buffer: IMFMediaBuffer = sample
            .ConvertToContiguousBuffer()
            .map_err(|e| H264Error::DecodeFailed(format!("ConvertToContiguousBuffer: {e}")))?;

        let mut buf_ptr: *mut u8 = ptr::null_mut();
        let mut cur_len: u32 = 0;
        buffer
            .Lock(&mut buf_ptr, None, Some(&mut cur_len))
            .map_err(|e| H264Error::DecodeFailed(format!("output Lock: {e}")))?;

        let data = std::slice::from_raw_parts(buf_ptr, cur_len as usize);

        let w = self.width;
        let h = self.height;

        if w == 0 || h == 0 {
            buffer.Unlock().ok();
            return Ok(None);
        }

        // Acquire a pooled buffer — avoids heap allocation on the hot path.
        let out_size = w as usize * h as usize * 4;
        let mut rgba = self.pool.acquire(out_size);

        if self.output_subtype == MFVideoFormat_NV12 {
            if self.output_stride > 0 && self.output_stride != w {
                yuv_convert::nv12_strided_to_rgba_into(data, self.output_stride as usize, w, h, &mut rgba);
            } else {
                yuv_convert::nv12_to_rgba_into(data, w, h, &mut rgba);
            }
        } else {
            // I420 / IYUV
            let y_size = w as usize * h as usize;
            let uv_size = (w as usize / 2) * (h as usize / 2);
            if data.len() >= y_size + uv_size * 2 {
                let y_plane = &data[..y_size];
                let u_plane = &data[y_size..y_size + uv_size];
                let v_plane = &data[y_size + uv_size..];
                yuv_convert::yuv420_planar_to_rgba_inner_into(
                    y_plane, u_plane, v_plane,
                    w as usize, w as usize / 2, w as usize / 2,
                    w as usize, h as usize, &mut rgba,
                );
            } else {
                rgba.resize(out_size, 0);
                rgba.fill(0);
            }
        }

        buffer
            .Unlock()
            .map_err(|e| H264Error::DecodeFailed(format!("output Unlock: {e}")))?;

        Ok(Some(DecodedFrame {
            width: w,
            height: h,
            rgba,
        }))
    }
}

impl H264Decoder for MfH264Decoder {
    fn decode(&mut self, nal_data: &[u8]) -> Result<Vec<DecodedFrame>, H264Error> {
        if nal_data.is_empty() {
            return Ok(Vec::new());
        }

        unsafe {
            let sample = Self::create_input_sample(nal_data)?;

            match self.transform.ProcessInput(0, &sample, 0) {
                Ok(()) => {}
                Err(e) if e.code() == MF_E_NOTACCEPTING => {
                    // MFT buffer full — drain first then retry
                    let mut frames = self.pull_output_frames()?;
                    if let Err(e2) = self.transform.ProcessInput(0, &sample, 0) {
                        log::warn!("MF ProcessInput retry failed: {e2}");
                    }
                    frames.extend(self.pull_output_frames()?);
                    return Ok(frames);
                }
                Err(e) => {
                    return Err(H264Error::DecodeFailed(format!("ProcessInput: {e}")));
                }
            }
        }

        self.pull_output_frames()
    }

    fn flush(&mut self) -> Result<Vec<DecodedFrame>, H264Error> {
        unsafe {
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0);
        }
        self.pull_output_frames()
    }

    fn name(&self) -> &'static str {
        if self.hardware {
            "mf-dxva2"
        } else {
            "mf-software"
        }
    }
}

impl Drop for MfH264Decoder {
    fn drop(&mut self) {
        unsafe {
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
        }
    }
}
