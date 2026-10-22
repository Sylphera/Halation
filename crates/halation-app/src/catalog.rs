#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub icon: &'static str,
    /// What the tool relies on, as Settings > Tools lists it
    pub summary: &'static str,
    /// One line on what it does, under its picture in the Workspace
    pub pitch: &'static str,
    /// Rail group: a divider separates groups
    pub group: i32,
    /// Marked Beta in Settings > Tools
    pub beta: bool,
    /// Components it needs that the beta does not have (none is installable here)
    pub missing: &'static str,
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
        pitch: "Video, audio and artwork from a link.",
        group: 1,
        beta: false,
        missing: "yt-dlp, FFmpeg",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "converter",
        name: "Converter",
        icon: "convert",
        summary: "Uses FFmpeg (optional), Pandoc (text documents) (optional), LibreOffice (office documents) (optional), PDFium (PDF pages) (optional)",
        pitch: "Media, documents and PDF pages.",
        group: 1,
        beta: true,
        missing: "",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "vocal-remover",
        name: "Vocal Remover",
        icon: "vocal",
        summary: "Uses FFmpeg, ONNX Runtime with DirectML, Vocal Remover model (UVR-MDX-NET Inst HQ4), Vocal Remover 4-stem model (HTDemucs) (optional)",
        pitch: "Vocals, instrumental or four stems.",
        group: 2,
        beta: true,
        missing: "FFmpeg, ONNX Runtime with DirectML, Vocal Remover model (UVR-MDX-NET Inst HQ4)",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "audio-visualizer",
        name: "Audio Visualizer",
        icon: "visualizer",
        summary: "Uses FFmpeg (optional), Cutout (background removal) (optional)",
        pitch: "Audio-reactive videos in any format.",
        group: 2,
        beta: false,
        missing: "",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "grade",
        name: "Grade",
        icon: "grade",
        summary: "Uses Cutout (background removal) (optional)",
        pitch: "Looks, layers and effects for images.",
        group: 3,
        beta: false,
        missing: "",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "cover-test",
        name: "Cover Test",
        icon: "cover",
        summary: "Needs nothing extra",
        pitch: "Your cover where it will be seen.",
        group: 3,
        beta: true,
        missing: "",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "background-remover",
        name: "Background Remover",
        icon: "removebg",
        summary: "Uses Cutout (background removal) (optional)",
        pitch: "Subjects cut out in a click.",
        group: 3,
        beta: true,
        missing: "",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "upscale",
        name: "Upscale",
        icon: "upscale",
        summary: "Uses Upscayl engine, Upscale models, Video Upscale / SPAN, FFmpeg, Cutout (background removal) (optional)",
        pitch: "Sharper images and video, ×2 or ×4.",
        group: 3,
        beta: false,
        missing: "Upscayl engine, Upscale models, Video Upscale / SPAN, FFmpeg",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "ai-interpolate",
        name: "AI Interpolate",
        icon: "interp",
        summary: "Uses RIFE (frame interpolation), FFmpeg",
        pitch: "Smoother motion, higher frame rates.",
        group: 4,
        beta: true,
        missing: "RIFE (frame interpolation), FFmpeg",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "frame-capture",
        name: "Frame Capture",
        icon: "framegrab",
        summary: "Uses FFmpeg",
        pitch: "Exact frames at full resolution.",
        group: 4,
        beta: true,
        missing: "FFmpeg",
        available: false,
        reason: ENGINE_OFF,
    },
    ToolSpec {
        id: "library",
        name: "Library",
        icon: "library",
        summary: "Needs nothing extra",
        pitch: "Your files, kept where they are.",
        group: 5,
        beta: false,
        missing: "",
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

/// Downloadable components and their approximate download size, as Settings > Tools lists them. The beta cannot
/// install any of them.
pub const COMPONENTS: [(&str, &str); 13] = [
    ("FFmpeg", "140 MB"),
    ("yt-dlp", "18 MB"),
    ("Upscayl engine", "10 MB"),
    ("Upscale models", "70 MB"),
    ("Cutout (background removal)", "445 MB"),
    ("RIFE (frame interpolation)", "180 MB"),
    ("Video Upscale / SPAN", "14 MB"),
    ("Pandoc (text documents)", "40 MB"),
    ("LibreOffice (office documents)", "360 MB"),
    ("PDFium (PDF pages)", "4 MB"),
    ("ONNX Runtime with DirectML", "36 MB"),
    ("Vocal Remover model (UVR-MDX-NET Inst HQ4)", "59 MB"),
    ("Vocal Remover 4-stem model (HTDemucs)", "170 MB"),
];

/// Settings section a search finds: the first section whose words contain every word of `query`
pub fn settings_section(query: &str) -> Option<usize> {
    const SECTIONS: [&str; 8] = [
        "general language english spanish espanol reduce animations motion processes dock notify notification job finishes",
        "interface dock compact expand keep open activity window maximized full screen",
        "you artist name youtube spotify soundcloud instagram tiktok links profile",
        "files save export location ask halation folder name template video image",
        "processing mode quiet balanced fast graphics card gpu vocal remover processor jobs downloads minimized",
        "tools components install missing ffmpeg yt-dlp upscayl rife cutout pandoc libreoffice pdfium onnx engine",
        "storage space workspace budget clean caches size",
        "about version license notices updates changelog folders import",
    ];
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    if words.is_empty() {
        return None;
    }
    SECTIONS
        .iter()
        .position(|section| words.iter().all(|word| section.contains(word.as_str())))
}
