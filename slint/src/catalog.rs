#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub icon: &'static str,
    pub available: bool,
    pub reason: &'static str,
}

const ENGINE_OFF: &str = "Processing engines are not connected in this beta.";

pub const TOOLS: [ToolSpec; 11] = [
    ToolSpec {
        id: "downloader",
        name: "Downloader",
        icon: "download",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "converter",
        name: "Converter",
        icon: "convert",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "vocal-remover",
        name: "Vocal Remover",
        icon: "vocal",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "audio-visualizer",
        name: "Audio Visualizer",
        icon: "visualizer",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "grade",
        name: "Grade",
        icon: "grade",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "cover-test",
        name: "Cover Test",
        icon: "cover",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "background-remover",
        name: "Background Remover",
        icon: "removebg",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "upscale",
        name: "Upscale",
        icon: "upscale",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "ai-interpolate",
        name: "AI Interpolate",
        icon: "interp",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "frame-capture",
        name: "Frame Capture",
        icon: "framegrab",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "library",
        name: "Library",
        icon: "library",
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
