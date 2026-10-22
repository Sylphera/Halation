#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub icon: &'static str,
    /// What the tool does, in one line: the collapsed sidebar's tooltip
    pub about: &'static str,
    /// What the tool relies on, as Settings > Tools lists it
    pub summary: &'static str,
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
        about: "Download audio or video from a link",
        summary: "Uses yt-dlp, FFmpeg, Cutout (background removal) (optional)",
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
        about: "Convert media, documents and images",
        summary: "Uses FFmpeg (optional), Pandoc (text documents) (optional), LibreOffice (office documents) (optional), PDFium (PDF pages) (optional)",
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
        about: "Split the vocals from the instrumental",
        summary: "Uses FFmpeg, ONNX Runtime with DirectML, Vocal Remover model (UVR-MDX-NET Inst HQ4), Vocal Remover 4-stem model (HTDemucs) (optional)",
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
        about: "Turn a track into a video that moves with it",
        summary: "Uses FFmpeg (optional), Cutout (background removal) (optional)",
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
        about: "Grade images with looks and colour layers",
        summary: "Uses Cutout (background removal) (optional)",
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
        about: "See a cover inside YouTube, Spotify and SoundCloud before publishing",
        summary: "Needs nothing extra",
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
        about: "Cut the subject out of an image",
        summary: "Uses Cutout (background removal) (optional)",
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
        about: "Enlarge images and video with AI",
        summary: "Uses Upscayl engine, Upscale models, Video Upscale / SPAN, FFmpeg, Cutout (background removal) (optional)",
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
        about: "Multiply a video's frame rate with AI interpolation",
        summary: "Uses RIFE (frame interpolation), FFmpeg",
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
        about: "Pull still frames out of a video",
        summary: "Uses FFmpeg",
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
        about: "Your references and sections",
        summary: "Needs nothing extra",
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
