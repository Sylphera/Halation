//! `--screenshot <page> <width>x<height> <out.png>`: one headless snapshot of a page, for visual review without
//! opening a window or touching the desktop. Diagnostic builds only (`diag-screenshot`); the shipping build has none
//! of this code. It renders with Slint's software renderer into memory, so it approximates the layout of the real
//! Skia window (text and edges differ); each run says so. The page is set by property, no input is simulated.
//! Fixtures (made-up names, tiny files) are written next to the output, never in a real profile.

use crate::app::Controller;
use crate::folders::{Command, FolderStore};
use crate::library::{LibraryEntry, write_index};
use crate::profile::{LaunchOptions, Profile, ScreenshotSpec};
use crate::ui::AppWindow;
use slint::EventLoopError;
use slint::platform::{
    EventLoopProxy, Platform, PlatformError, WindowAdapter,
    software_renderer::{MinimalSoftwareWindow, RepaintBufferType},
};
use slint::{ComponentHandle, PhysicalSize, Rgb8Pixel};
use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
    rc::Rc,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

type Task = Box<dyn FnOnce() + Send>;
type Queue = Arc<Mutex<VecDeque<Task>>>;

struct Headless {
    window: Rc<MinimalSoftwareWindow>,
    queue: Queue,
    start: Instant,
}

struct Proxy(Queue);

impl EventLoopProxy for Proxy {
    fn quit_event_loop(&self) -> Result<(), EventLoopError> {
        Ok(())
    }

    fn invoke_from_event_loop(&self, event: Task) -> Result<(), EventLoopError> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push_back(event);
        Ok(())
    }
}

impl Platform for Headless {
    fn create_window_adapter(&self) -> Result<Rc<dyn WindowAdapter>, PlatformError> {
        Ok(self.window.clone())
    }

    fn duration_since_start(&self) -> Duration {
        self.start.elapsed()
    }

    fn new_event_loop_proxy(&self) -> Option<Box<dyn EventLoopProxy>> {
        Some(Box::new(Proxy(self.queue.clone())))
    }
}

/// Runs what worker threads queued for the UI thread and advances timers and animations
fn pump(queue: &Queue, span: Duration) {
    let end = Instant::now() + span;
    while Instant::now() < end {
        loop {
            let next = queue
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .pop_front();
            match next {
                Some(task) => task(),
                None => break,
            }
        }
        slint::platform::update_timers_and_animations();
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn touch(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, b"fixture")
}

/// Made-up Library content: own sections, a pack, a linked folder and a few references
fn fixtures(root: &Path) -> Result<Profile, Box<dyn std::error::Error>> {
    let profile = Profile::at(root.join("profile"));
    profile.ensure()?;
    let library = profile.sections_root();
    for name in ["cover-01.png", "cover-02.png", "teaser.mp4"] {
        touch(&library.join("Covers").join(name))?;
    }
    touch(
        &library
            .join("Posters")
            .join("poster-a-rather-long-file-name-for-the-list.webp"),
    )?;
    touch(&library.join("Packs").join("Grain").join("grain-35mm.webp"))?;
    let photos = root.join("linked-photos");
    touch(&photos.join("beach.jpg"))?;
    touch(&photos.join("city.jpg"))?;
    FolderStore::load(profile.sections_root(), profile.links_path()).run(Command::Link(photos));
    let entries: Vec<LibraryEntry> = [
        ("a", "Songs/first-song.wav", "first-song.wav", false),
        ("b", "Art/sleeve.png", "sleeve.png", false),
        ("c", "Gone/old-take.mp3", "old-take.mp3", true),
    ]
    .iter()
    .map(|(id, path, name, missing)| LibraryEntry {
        id: (*id).to_owned(),
        path: format!("C:/fixture/{path}"),
        display_name: (*name).to_owned(),
        missing: *missing,
        added_at: 1,
    })
    .collect();
    write_index(&profile.library_path(), &entries)?;
    Ok(profile)
}

fn write_png(path: &Path, width: u32, height: u32, pixels: &[Rgb8Pixel]) -> std::io::Result<()> {
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = !0_u32;
        for &byte in data {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
        out.extend((data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend(data);
        out.extend(&body);
        out.extend(crc32(&body).to_be_bytes());
    }
    let mut raw = Vec::with_capacity((width as usize * 3 + 1) * height as usize);
    for row in pixels.chunks(width as usize) {
        raw.push(0);
        for px in row {
            raw.extend([px.r, px.g, px.b]);
        }
    }
    // zlib with stored (uncompressed) blocks: no compression crate needed for a diagnostic image
    let mut z = vec![0x78, 0x01];
    let mut blocks = raw.chunks(65_535).peekable();
    while let Some(block) = blocks.next() {
        z.push(u8::from(blocks.peek().is_none()));
        z.extend((block.len() as u16).to_le_bytes());
        z.extend((!(block.len() as u16)).to_le_bytes());
        z.extend(block);
    }
    let (mut a, mut b) = (1_u32, 0_u32);
    for &byte in &raw {
        a = (a + u32::from(byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    z.extend(((b << 16) | a).to_be_bytes());

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    let mut ihdr = Vec::new();
    ihdr.extend(width.to_be_bytes());
    ihdr.extend(height.to_be_bytes());
    ihdr.extend([8, 2, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &ihdr);
    chunk(&mut png, b"IDAT", &z);
    chunk(&mut png, b"IEND", &[]);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, png)
}

fn profile_tools(out_dir: &Path, page: &str) -> PathBuf {
    out_dir
        .join(format!("fixtures-{page}"))
        .join("profile")
        .join("tools")
}

pub fn run(spec: ScreenshotSpec) -> Result<(), Box<dyn std::error::Error>> {
    // home, home-open (sidebar open), settings, settings-<0..7> (a section), home-pointer (a pointer over the strip's
    // left half, for the dock's light), home-hover (a pointer at rest over the drop zone)
    let (page, mode, section) = match spec.page.as_str() {
        "home" => (0, 0, -1),
        "home-open" => (0, 2, -1),
        "home-pointer" => (0, 0, -2),
        // A real pointer over the drop zone's middle: it must stay flat under it
        "home-hover" => (0, 6, -1),
        "settings" => (3, 0, -1),
        "converter" => (4, 0, -1),
        "converter-open" => (4, 2, -1),
        "converter-ready" => (4, 3, -1),
        "converter-audio" => (4, 4, -1),
        "converter-video" => (4, 5, -1),
        other => match other
            .strip_prefix("settings-")
            .and_then(|n| n.parse::<i32>().ok())
        {
            Some(section) if (0..8).contains(&section) => (3, 0, section),
            _ => {
                return Err(format!(
                    "unknown page '{other}'; expected home, home-open, home-pointer, home-hover, settings, settings-<0..7>, converter, converter-open, converter-ready, converter-audio or converter-video"
                )
                .into());
            }
        },
    };
    // Absolute, like a real profile: FFmpeg runs in its own folder
    let out_dir = std::path::absolute(
        spec.out
            .parent()
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf),
    )?;
    let profile = fixtures(&out_dir.join(format!("fixtures-{}", spec.page)))?;

    let window = MinimalSoftwareWindow::new(RepaintBufferType::NewBuffer);
    let queue: Queue = Arc::default();
    slint::platform::set_platform(Box::new(Headless {
        window: window.clone(),
        queue: queue.clone(),
        start: Instant::now(),
    }))
    .map_err(|e| format!("could not install the headless platform: {e}"))?;

    // Like a normal start: the typeface from the assets folder before the window exists
    let _ = crate::assets::register_fonts(&crate::assets::locate());
    let ui = AppWindow::new()?;
    ui.show()?;
    window.set_size(PhysicalSize::new(spec.width, spec.height));
    ui.window()
        .dispatch_event(slint::platform::WindowEvent::Resized {
            size: slint::LogicalSize::new(spec.width as f32, spec.height as f32),
        });

    let controller = Controller::new(ui.as_weak(), profile, LaunchOptions::default())?;
    controller.install(false);

    ui.invoke_navigate(page);
    if mode == 2 {
        ui.set_rail_open(true);
    }
    pump(&queue, Duration::from_millis(800));
    if mode == 3 {
        let fixture = out_dir.join("generated-converter-preview.png");
        let pixels: Vec<_> = (0..200)
            .flat_map(|y| {
                (0..320)
                    .map(move |x| Rgb8Pixel::new((x * 255 / 320) as u8, (y * 255 / 200) as u8, 96))
            })
            .collect();
        write_png(&fixture, 320, 200, &pixels)?;
        controller.add_converter_files(vec![fixture]);
        pump(&queue, Duration::from_millis(1000));
    }
    if mode == 4 {
        // Generated audio (FFmpeg from the profile's tools or PATH): a pulsing tone with a quiet start
        let ffmpeg = halation_core::components::Ffmpeg::find(&profile_tools(&out_dir, &spec.page))
            .ok_or("converter-audio needs FFmpeg on PATH to generate its fixture")?;
        // Absolute: FFmpeg runs from its own folder
        let fixture = out_dir.join("generated-converter-tone.flac");
        let status = std::process::Command::new(&ffmpeg.ffmpeg)
            .args(["-hide_banner", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i"])
            .arg("aevalsrc=min(1\\,t/6)*(0.25+0.75*abs(sin(2*PI*0.21*t)))*(0.6+0.4*sin(2*PI*2.1*t))*sin(2*PI*330*t):s=44100:d=94")
            .arg(&fixture)
            .status()?;
        if !status.success() {
            return Err("could not generate the audio fixture".into());
        }
        controller.add_converter_files(vec![fixture]);
        pump(&queue, Duration::from_millis(2500));
        // A paused head part-way through, so the heard part and the head show without real-time playback
        ui.invoke_converter_seek(0.38);
        pump(&queue, Duration::from_millis(200));
    }
    if mode == 5 {
        let ffmpeg = halation_core::components::Ffmpeg::find(&profile_tools(&out_dir, &spec.page))
            .ok_or("converter-video needs FFmpeg on PATH to generate its fixture")?;
        let fixture = out_dir.join("generated-converter-clip.mkv");
        let status = std::process::Command::new(&ffmpeg.ffmpeg)
            .args([
                "-hide_banner",
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
            ])
            .arg("testsrc2=size=1920x800:rate=24:duration=12")
            .args([
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=330:duration=12",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
            ])
            .arg(&fixture)
            .status()?;
        if !status.success() {
            return Err("could not generate the video fixture".into());
        }
        controller.add_converter_files(vec![fixture]);
        pump(&queue, Duration::from_millis(2500));
        ui.set_convert_left_open(true);
        // Paused at 40 %: the still at the head and the seek bar
        ui.invoke_converter_seek(0.4);
        pump(&queue, Duration::from_millis(2000));
    }
    if section >= 0 {
        // After the page has laid out, so the section tops are known
        ui.set_settings_jump(section);
        pump(&queue, Duration::from_millis(300));
        // Once more, now that the content height has settled too
        ui.set_settings_jump(-1);
        ui.set_settings_jump(section);
        pump(&queue, Duration::from_millis(300));
    }
    if mode == 6 {
        // A real pointer resting over the drop zone's middle (the built-in hover pipeline, no glow must answer it)
        ui.window()
            .dispatch_event(slint::platform::WindowEvent::PointerMoved {
                position: slint::LogicalPosition::new(spec.width as f32 * 0.5, 680.0),
            });
        pump(&queue, Duration::from_millis(100));
        ui.window()
            .dispatch_event(slint::platform::WindowEvent::PointerMoved {
                position: slint::LogicalPosition::new(spec.width as f32 * 0.5, 680.0),
            });
        pump(&queue, Duration::from_millis(600));
    }
    if section == -2 {
        // A pointer resting over the tool strip's right half: the dock's light follows it (headless, no mouse to move)
        ui.set_home_pointer_on(true);
        ui.set_home_pointer_x(spec.width as f32 * 0.6);
        pump(&queue, Duration::from_millis(400));
    }

    let (w, h) = (spec.width as usize, spec.height as usize);
    let mut buffer = vec![Rgb8Pixel::new(0, 0, 0); w * h];
    let drawn = window.draw_if_needed(|renderer| {
        renderer.render(&mut buffer, w);
    });
    controller.shutdown();
    if !drawn {
        return Err("the window had nothing to draw".into());
    }
    write_png(&spec.out, spec.width, spec.height, &buffer)?;
    println!(
        "captured {} ({}x{}, page {}) renderer=software (approximation of the Skia window layout; text and edges differ)",
        spec.out.display(),
        spec.width,
        spec.height,
        spec.page
    );
    Ok(())
}
