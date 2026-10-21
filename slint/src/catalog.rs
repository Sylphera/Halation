#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub icon: &'static str,
    /// What the tool relies on, as Settings > Tools lists it
    pub summary: &'static str,
    /// Rail group: a divider separates groups
    pub group: i32,
    /// Marked Beta in Settings > Tools
    pub beta: bool,
    pub available: bool,
    pub reason: &'static str,
}

const ENGINE_OFF: &str = "Processing engines are not connected in this beta.";

pub const TOOLS: [ToolSpec; 11] = [
    ToolSpec {
        id: "downloader",
        name: "Downloader",
        icon: "download",
        summary: "Uses yt-dlp, FFmpeg, Cutout (background removal) (optional)",
        group: 1,
        beta: false,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "converter",
        name: "Converter",
        icon: "convert",
        summary: "Uses FFmpeg (optional), Pandoc (text documents) (optional), LibreOffice (office documents) (optional), PDFium (PDF pages) (optional)",
        group: 1,
        beta: true,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "vocal-remover",
        name: "Vocal Remover",
        icon: "vocal",
        summary: "Uses FFmpeg, ONNX Runtime with DirectML, Vocal Remover model (UVR-MDX-NET Inst HQ4), Vocal Remover 4-stem model (HTDemucs) (optional)",
        group: 2,
        beta: true,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "audio-visualizer",
        name: "Audio Visualizer",
        icon: "visualizer",
        summary: "Uses FFmpeg (optional), Cutout (background removal) (optional)",
        group: 2,
        beta: false,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "grade",
        name: "Grade",
        icon: "grade",
        summary: "Uses Cutout (background removal) (optional)",
        group: 3,
        beta: false,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "cover-test",
        name: "Cover Test",
        icon: "cover",
        summary: "Needs nothing extra",
        group: 3,
        beta: true,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "background-remover",
        name: "Background Remover",
        icon: "removebg",
        summary: "Uses Cutout (background removal) (optional)",
        group: 3,
        beta: true,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "upscale",
        name: "Upscale",
        icon: "upscale",
        summary: "Uses Upscayl engine, Upscale models, Video Upscale / SPAN, FFmpeg, Cutout (background removal) (optional)",
        group: 3,
        beta: false,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "ai-interpolate",
        name: "AI Interpolate",
        icon: "interp",
        summary: "Uses RIFE (frame interpolation), FFmpeg",
        group: 4,
        beta: true,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "frame-capture",
        name: "Frame Capture",
        icon: "framegrab",
        summary: "Uses FFmpeg",
        group: 4,
        beta: true,
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "library",
        name: "Library",
        icon: "library",
        summary: "Needs nothing extra",
        group: 5,
        beta: false,
        available: true,
        reason: "Reference library (available in this beta).",
    },
];

pub fn tool(id: &str) -> Option<&'static ToolSpec> {
    TOOLS.iter().find(|tool| tool.id == id)
}

pub fn activation_notice(id: &str) -> String {
    match tool(id) {
        Some(tool) if tool.available => format!("{} is available in this beta.", tool.name),
        Some(tool) => format!(
            "{} is not available in this beta. {}",
            tool.name, tool.reason
        ),
        None => "That tool is not part of this beta.".to_owned(),
    }
}
