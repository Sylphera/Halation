//! In-process Windows video decoding through Media Foundation's Source Reader.
//!
//! Media Foundation selects the installed decoder MFTs and requests hardware transforms where available. It is not a
//! promise of GPU decoding: the system/driver may select software, and unsupported formats are reported to the caller
//! so Frame Capture can use its existing FFmpeg fallback.

use crate::framegrab::{RawFrame, VideoInfo, fit_size};
use std::path::Path;

#[cfg(all(windows, test))]
static LAST_STAGE_TIMES: std::sync::Mutex<
    Option<(
        std::time::Duration,
        std::time::Duration,
        std::time::Duration,
    )>,
> = std::sync::Mutex::new(None);

#[cfg(all(windows, test))]
pub(crate) fn take_last_stage_times() -> Option<(
    std::time::Duration,
    std::time::Duration,
    std::time::Duration,
)> {
    LAST_STAGE_TIMES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take()
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod platform {
    use super::*;
    use windows::Win32::{
        Media::MediaFoundation::{
            IMF2DBuffer, IMFActivate, IMFSourceReader, MF_MT_FRAME_SIZE, MF_MT_MAJOR_TYPE,
            MF_MT_SUBTYPE, MF_MT_VIDEO_NOMINAL_RANGE, MF_MT_YUV_MATRIX,
            MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_SOURCE_READER_FIRST_VIDEO_STREAM,
            MF_SOURCE_READERF_ENDOFSTREAM, MF_VERSION, MFCreateAttributes, MFCreateMediaType,
            MFCreateSourceReaderFromURL, MFMediaType_Video, MFNominalRange_0_255, MFSTARTUP_LITE,
            MFShutdown, MFStartup, MFT_CATEGORY_VIDEO_DECODER, MFT_ENUM_FLAG_HARDWARE,
            MFT_ENUM_FLAG_SYNCMFT, MFT_FRIENDLY_NAME_Attribute, MFT_REGISTER_TYPE_INFO, MFTEnumEx,
            MFVideoFormat_H264, MFVideoFormat_NV12, MFVideoTransferMatrix_BT709,
        },
        System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoTaskMemFree, CoUninitialize},
    };
    use windows::core::{GUID, HSTRING, Interface};

    const TICKS_PER_SECOND: f64 = 10_000_000.0;
    const STREAM: u32 = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;

    struct Session;

    impl Session {
        fn start() -> Result<Self, String> {
            // SAFETY: COM and MF are initialized and shut down on this worker thread.
            unsafe {
                CoInitializeEx(None, COINIT_MULTITHREADED)
                    .ok()
                    .map_err(|e| e.to_string())?;
                if let Err(error) = MFStartup(MF_VERSION, MFSTARTUP_LITE) {
                    CoUninitialize();
                    return Err(error.to_string());
                }
            }
            Ok(Self)
        }
    }

    impl Drop for Session {
        fn drop(&mut self) {
            // SAFETY: called on the same thread after the reader and media types were dropped.
            unsafe {
                let _ = MFShutdown();
                CoUninitialize();
            }
        }
    }

    struct Reader {
        source: IMFSourceReader,
        width: u32,
        height: u32,
        output_width: u32,
        output_height: u32,
        bt709: bool,
        full_range: bool,
        #[cfg(test)]
        read_sample_time: std::time::Duration,
        #[cfg(test)]
        lock_time: std::time::Duration,
        #[cfg(test)]
        convert_time: std::time::Duration,
        _session: Session,
    }

    impl Reader {
        fn open(path: &Path, width: u32, height: u32) -> Result<Self, String> {
            let session = Session::start()?;
            // SAFETY: interfaces are owned on this thread; MF out parameters are valid for the duration of each call.
            unsafe {
                let mut attributes = None;
                MFCreateAttributes(&mut attributes, 1).map_err(|e| e.to_string())?;
                let attributes = attributes.ok_or("Media Foundation returned no attributes")?;
                attributes
                    .SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1)
                    .map_err(|e| e.to_string())?;
                let source =
                    MFCreateSourceReaderFromURL(&HSTRING::from(path.as_os_str()), &attributes)
                        .map_err(|e| e.to_string())?;
                source
                    .SetStreamSelection(STREAM, true)
                    .map_err(|e| e.to_string())?;
                let media_type = MFCreateMediaType().map_err(|e| e.to_string())?;
                media_type
                    .SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)
                    .map_err(|e| e.to_string())?;
                media_type
                    .SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)
                    .map_err(|e| e.to_string())?;
                source
                    .SetCurrentMediaType(STREAM, None, &media_type)
                    .map_err(|e| e.to_string())?;
                let actual = source
                    .GetCurrentMediaType(STREAM)
                    .map_err(|e| e.to_string())?;
                let size = actual
                    .GetUINT64(&MF_MT_FRAME_SIZE)
                    .map_err(|e| e.to_string())?;
                let (actual_width, actual_height) = ((size >> 32) as u32, size as u32);
                if actual_width == 0 || actual_height == 0 {
                    return Err("Media Foundation reported an empty frame size".into());
                }
                let matrix = actual.GetUINT32(&MF_MT_YUV_MATRIX).unwrap_or(0);
                let range = actual.GetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE).unwrap_or(0);
                Ok(Self {
                    source,
                    width: actual_width,
                    height: actual_height,
                    output_width: width,
                    output_height: height,
                    bt709: matrix == MFVideoTransferMatrix_BT709.0 as u32
                        || (matrix == 0 && actual_height > 576),
                    full_range: range == MFNominalRange_0_255.0 as u32,
                    #[cfg(test)]
                    read_sample_time: std::time::Duration::ZERO,
                    #[cfg(test)]
                    lock_time: std::time::Duration::ZERO,
                    #[cfg(test)]
                    convert_time: std::time::Duration::ZERO,
                    _session: session,
                })
            }
        }

        fn frame(
            &mut self,
            info: &VideoInfo,
            cancelled: &dyn Fn() -> bool,
        ) -> Result<Option<RawFrame>, String> {
            // ReadSample timestamps use 100 ns units. Mapping them through the probed rational rate retains the
            // public frame-index contract for constant-frame-rate media; the decoder's timestamps avoid float seeks.
            let mut empty_samples = 0_u32;
            loop {
                if cancelled() {
                    return Err("Cancelled".into());
                }
                let (mut flags, mut timestamp) = (0_u32, 0_i64);
                let mut sample = None;
                #[cfg(test)]
                let read_start = std::time::Instant::now();
                // SAFETY: output pointers live through the call; sample is an owning COM interface afterward.
                unsafe {
                    self.source
                        .ReadSample(
                            STREAM,
                            0,
                            None,
                            Some(&mut flags),
                            Some(&mut timestamp),
                            Some(&mut sample),
                        )
                        .map_err(|e| e.to_string())?;
                }
                #[cfg(test)]
                {
                    self.read_sample_time += read_start.elapsed();
                }
                if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                    return Ok(None);
                }
                let Some(sample) = sample else {
                    empty_samples += 1;
                    if empty_samples >= 1024 {
                        return Err("Media Foundation returned too many empty samples".into());
                    }
                    continue;
                };
                let seconds = timestamp as f64 / TICKS_PER_SECOND - info.start_time;
                let n = (seconds.max(0.0) * f64::from(info.fps_num) / f64::from(info.fps_den))
                    .round() as u64;
                // SAFETY: lock the decoded NV12 surface for read; the pointer/pitch are valid until Unlock2D.
                let buffer: IMF2DBuffer = unsafe {
                    sample
                        .GetBufferByIndex(0)
                        .map_err(|e| e.to_string())?
                        .cast()
                        .map_err(|e| e.to_string())?
                };
                let buffer_length =
                    unsafe { buffer.GetContiguousLength() }.map_err(|e| e.to_string())? as usize;
                let mut pointer = std::ptr::null_mut();
                let mut pitch = 0_i32;
                #[cfg(test)]
                let lock_start = std::time::Instant::now();
                unsafe {
                    buffer
                        .Lock2D(&mut pointer, &mut pitch)
                        .map_err(|e| e.to_string())?;
                }
                #[cfg(test)]
                {
                    self.lock_time += lock_start.elapsed();
                }
                #[cfg(test)]
                let convert_start = std::time::Instant::now();
                let result = (|| {
                    if pointer.is_null() || pitch <= 0 || (pitch as u32) < self.width {
                        return Err(
                            "Media Foundation returned an unsupported NV12 pitch".to_owned()
                        );
                    }
                    let stride = pitch as usize;
                    // Media Foundation's NV12 2D surface aligns each plane to 16 scanlines. GetContiguousLength
                    // includes that padding; the UV plane therefore starts after the padded Y plane, not at
                    // `stride * height` (which reads the zero-filled padding as chroma and tints the top rows green).
                    const PLANE_ROW_ALIGNMENT: usize = 16;
                    let align_rows = |rows: usize| {
                        rows.checked_add(PLANE_ROW_ALIGNMENT - 1)
                            .map(|padded| padded & !(PLANE_ROW_ALIGNMENT - 1))
                    };
                    let y_rows = align_rows(self.height as usize)
                        .ok_or("Media Foundation NV12 Y-plane size overflow")?;
                    let uv_rows = align_rows((self.height as usize).div_ceil(2))
                        .ok_or("Media Foundation NV12 UV-plane size overflow")?;
                    let source_rows = y_rows
                        .checked_add(uv_rows)
                        .ok_or("Media Foundation NV12 surface row count overflow")?;
                    let source_bytes = stride
                        .checked_mul(source_rows)
                        .ok_or("Media Foundation frame size overflow")?;
                    if buffer_length < source_bytes {
                        return Err("Media Foundation returned a short NV12 surface".into());
                    }
                    let uv_offset = stride
                        .checked_mul(y_rows)
                        .ok_or("Media Foundation NV12 UV-plane offset overflow")?;
                    let pixel_count = self.output_width as usize * self.output_height as usize;
                    let mut rgba = vec![0; pixel_count * 4];
                    // Resolve conversion coefficients once per frame, not once per pixel.
                    let (kr, kg_u, kg_v, kb, luma_scale, y_offset) =
                        match (self.bt709, self.full_range) {
                            (true, true) => (1.5748, 0.1873, 0.4681, 1.8556, 1.0, 0.0),
                            (true, false) => (1.793, 0.213, 0.533, 2.112, 1.164, 16.0),
                            (false, true) => (1.402, 0.3441, 0.7141, 1.772, 1.0, 0.0),
                            (false, false) => (1.596, 0.392, 0.813, 2.017, 1.164, 16.0),
                        };
                    for y in 0..self.output_height {
                        let sy = (u64::from(y) * u64::from(self.height)
                            / u64::from(self.output_height))
                            as usize;
                        let y_row = unsafe { pointer.add(sy * stride) };
                        let uv_row = unsafe { pointer.add(uv_offset + (sy / 2) * stride) };
                        for x in 0..self.output_width {
                            let sx = (u64::from(x) * u64::from(self.width)
                                / u64::from(self.output_width))
                                as usize;
                            let yy = unsafe { *y_row.add(sx) } as f32;
                            let uv = unsafe { uv_row.add((sx / 2) * 2) };
                            let u = unsafe { *uv } as f32 - 128.0;
                            let v = unsafe { *uv.add(1) } as f32 - 128.0;
                            // HD defaults to BT.709; SD defaults to BT.601 when source metadata omitted it.
                            let luma = (yy - y_offset) * luma_scale;
                            let offset = (y as usize * self.output_width as usize + x as usize) * 4;
                            rgba[offset] = (luma + kr * v).round().clamp(0.0, 255.0) as u8;
                            rgba[offset + 1] =
                                (luma - kg_u * u - kg_v * v).round().clamp(0.0, 255.0) as u8;
                            rgba[offset + 2] = (luma + kb * u).round().clamp(0.0, 255.0) as u8;
                            rgba[offset + 3] = 255;
                        }
                    }
                    Ok(RawFrame {
                        index: n,
                        width: self.output_width,
                        height: self.output_height,
                        rgba,
                    })
                })();
                #[cfg(test)]
                {
                    self.convert_time += convert_start.elapsed();
                }
                let unlock = unsafe { buffer.Unlock2D() }.map_err(|e| e.to_string());
                return match (result, unlock) {
                    (Ok(frame), Ok(())) => Ok(Some(frame)),
                    (Err(error), _) | (_, Err(error)) => Err(error),
                };
            }
        }
    }

    pub(super) fn decode(
        path: &Path,
        info: &VideoInfo,
        from: u64,
        count: u32,
        max_width: u32,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<Vec<RawFrame>, String> {
        let (width, height) = if max_width == 0 {
            (info.width, info.height)
        } else {
            fit_size(info.width, info.height, max_width)
        };
        let mut reader = Reader::open(path, width, height)?;
        if (reader.width, reader.height) != (info.width, info.height) {
            return Err("Media Foundation frame dimensions differ from the video probe".into());
        }
        // Source Reader seeks to its preceding random-access point and returns timestamped preroll as needed; do not
        // seek an arbitrary two seconds earlier, which would waste work for long GOPs at high resolution.
        let timestamp = ((info.start_time + info.time(from)) * TICKS_PER_SECOND).round() as i64;
        let position = windows::Win32::System::Com::StructuredStorage::PROPVARIANT::from(timestamp);
        if timestamp > 0 {
            unsafe {
                reader
                    .source
                    .SetCurrentPosition(&GUID::zeroed(), &position)
                    .map_err(|e| e.to_string())?;
            }
        }
        let end = from.saturating_add(u64::from(count));
        let mut decoded = Vec::with_capacity(count as usize);
        let mut reads = 0_u32;
        while reads < count.saturating_add(100_000) {
            if cancelled() {
                return Err("Cancelled".into());
            }
            let Some(frame) = reader.frame(info, cancelled)? else {
                break;
            };
            reads += 1;
            if frame.index >= end {
                break;
            }
            if frame.index >= from && frame.index < end {
                decoded.push(frame);
                if decoded.len() == count as usize {
                    break;
                }
            }
        }
        #[cfg(test)]
        {
            *super::LAST_STAGE_TIMES
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = Some((
                reader.read_sample_time,
                reader.lock_time,
                reader.convert_time,
            ));
        }
        Ok(decoded)
    }

    pub(super) fn hardware_h264_transform_names() -> Result<Vec<String>, String> {
        let _session = Session::start()?;
        let input = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_H264,
        };
        let output = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: MFVideoFormat_NV12,
        };
        let flags = windows::Win32::Media::MediaFoundation::MFT_ENUM_FLAG(
            MFT_ENUM_FLAG_HARDWARE.0 | MFT_ENUM_FLAG_SYNCMFT.0,
        );
        let (mut activations, mut count) = (std::ptr::null_mut::<Option<IMFActivate>>(), 0_u32);
        // SAFETY: the returned activation interfaces and CoTaskMem array are released exactly once below.
        unsafe {
            MFTEnumEx(
                MFT_CATEGORY_VIDEO_DECODER,
                flags,
                Some(&input),
                Some(&output),
                &mut activations,
                &mut count,
            )
            .map_err(|error| error.to_string())?;
            if activations.is_null() {
                return Ok(Vec::new());
            }
            if count == 0 {
                CoTaskMemFree(Some(activations as *const _));
                return Ok(Vec::new());
            }
            let mut names = Vec::with_capacity(count as usize);
            for index in 0..count as usize {
                if let Some(activation) = activations.add(index).read() {
                    let mut name = windows::core::PWSTR::null();
                    let mut length = 0_u32;
                    if activation
                        .GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut name, &mut length)
                        .is_ok()
                    {
                        if let Ok(name_string) = name.to_string() {
                            names.push(name_string);
                        }
                        CoTaskMemFree(Some(name.0 as *const _));
                    }
                    drop(activation);
                }
            }
            CoTaskMemFree(Some(activations as *const _));
            Ok(names)
        }
    }
}

#[cfg(windows)]
pub(crate) fn decode_window(
    path: &Path,
    info: &VideoInfo,
    from: u64,
    count: u32,
    max_width: u32,
    cancelled: &dyn Fn() -> bool,
) -> Result<Vec<RawFrame>, String> {
    platform::decode(path, info, from, count, max_width, cancelled)
}

#[cfg(windows)]
pub fn hardware_h264_transform_names() -> Result<Vec<String>, String> {
    platform::hardware_h264_transform_names()
}

#[cfg(not(windows))]
pub(crate) fn decode_window(
    _path: &Path,
    _info: &VideoInfo,
    _from: u64,
    _count: u32,
    _max_width: u32,
    _cancelled: &dyn Fn() -> bool,
) -> Result<Vec<RawFrame>, String> {
    Err("In-process frame decoding is only available on Windows".into())
}
