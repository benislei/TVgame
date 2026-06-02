use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct CaptureOptions {
    pub display_id: Option<u32>,
    pub fps: Option<u32>,
    pub include_cursor: Option<bool>,
    pub max_queue_size: Option<u32>,
}

#[napi(object)]
pub struct DisplayInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub rotation: u32,
    pub adapter_luid: String,
    pub output_index: u32,
}

#[napi]
pub struct NativeFrame {
    pub width: u32,
    pub height: u32,
    pub stride: u32,
    pub timestamp_ns: i64,
    data: Buffer,
}

#[napi]
impl NativeFrame {
    #[napi(getter)]
    pub fn data(&self) -> Buffer {
        self.data.clone()
    }

    #[napi]
    pub fn release(&self) {
        // Production implementation returns the native frame-pool slot here.
    }
}

#[napi]
pub struct NativeDuplicator {
    options: CaptureOptions,
}

#[napi]
impl NativeDuplicator {
    #[napi(constructor)]
    pub fn new(options: CaptureOptions) -> Result<Self> {
        Ok(Self { options })
    }

    #[napi]
    pub async fn start(&self) -> Result<()> {
        platform_start(&self.options).await
    }

    #[napi]
    pub async fn stop(&self) -> Result<()> {
        Ok(())
    }

    #[napi]
    pub async fn next_frame(&self, _timeout_ms: Option<u32>) -> Result<Option<NativeFrame>> {
        platform_next_frame().await
    }

    #[napi(js_name = "getDisplayInfo")]
    pub fn get_display_info(&self) -> Result<DisplayInfo> {
        Ok(DisplayInfo {
            id: self.options.display_id.unwrap_or(0),
            name: "DXGI output".to_string(),
            width: 0,
            height: 0,
            rotation: 0,
            adapter_luid: String::new(),
            output_index: 0,
        })
    }
}

#[napi(js_name = "listDisplays")]
pub fn list_displays() -> Result<Vec<DisplayInfo>> {
    platform_list_displays()
}

#[cfg(not(windows))]
fn platform_list_displays() -> Result<Vec<DisplayInfo>> {
    Err(Error::new(
        Status::GenericFailure,
        "DXGI capture is only available on Windows".to_string(),
    ))
}

#[cfg(not(windows))]
async fn platform_start(_options: &CaptureOptions) -> Result<()> {
    Err(Error::new(
        Status::GenericFailure,
        "DXGI capture is only available on Windows".to_string(),
    ))
}

#[cfg(not(windows))]
async fn platform_next_frame() -> Result<Option<NativeFrame>> {
    Err(Error::new(
        Status::GenericFailure,
        "DXGI capture is only available on Windows".to_string(),
    ))
}

#[cfg(windows)]
fn platform_list_displays() -> Result<Vec<DisplayInfo>> {
    // Implementation outline:
    // 1. CreateDXGIFactory1
    // 2. EnumAdapters1
    // 3. EnumOutputs
    // 4. IDXGIOutput::GetDesc for desktop coordinates and name
    //
    // Keep this function synchronous; enumeration is cheap and helps JS select a display.
    Ok(Vec::new())
}

#[cfg(windows)]
async fn platform_start(_options: &CaptureOptions) -> Result<()> {
    // Production implementation:
    // - Create D3D11 device with D3D11_CREATE_DEVICE_BGRA_SUPPORT.
    // - Query IDXGIOutput1 and call DuplicateOutput.
    // - Spawn a capture thread pinned to the selected output.
    // - Use a 1-2 frame native pool; drop stale frames.
    Ok(())
}

#[cfg(windows)]
async fn platform_next_frame() -> Result<Option<NativeFrame>> {
    // Production implementation:
    // - AcquireNextFrame(timeout)
    // - CopyResource desktop texture -> D3D11_USAGE_STAGING texture
    // - Map staging texture
    // - Copy row-by-row into a native pooled BGRA Buffer
    // - Unmap and ReleaseFrame immediately
    //
    // Full zero-copy is not realistic because mapped D3D memory cannot outlive Unmap.
    // A fixed pool avoids per-frame allocation while keeping lifetime safe for Node.
    Ok(None)
}
