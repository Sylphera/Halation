use std::path::{Path, PathBuf};

// The package that gives Halation its identity on Windows (windows/identity): packed here with the Windows SDK's
// makeappx, which comes with the MSVC build tools, and installed with the app (tauri.conf.json resources). Built
// elsewhere (checks on Linux) an empty file stands in, so the resource exists; it is never shipped from there.
fn main() {
    println!("cargo:rerun-if-changed=windows/identity");
    println!("cargo:rerun-if-changed=windows/app.manifest");
    let out = Path::new("windows/identity-out/Halation.msix");
    std::fs::create_dir_all(out.parent().unwrap()).expect("windows/identity-out");
    let windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    match makeappx().filter(|_| windows && cfg!(windows)) {
        Some(tool) => {
            let _ = std::fs::remove_file(out);
            let ok = std::process::Command::new(&tool)
                .args(["pack", "/o", "/nv", "/d", "windows/identity", "/p"])
                .arg(out)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            assert!(ok, "makeappx could not pack windows/identity ({})", tool.display());
        }
        None if windows && cfg!(windows) => panic!("makeappx.exe not found: install the Windows SDK, or set MAKEAPPX"),
        None => {
            if !out.exists() {
                std::fs::write(out, b"").expect("placeholder package");
            }
        }
    }
    let attrs = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows/app.manifest")));
    tauri_build::try_build(attrs).expect("tauri build");
}

// MAKEAPPX, or the newest makeappx.exe of the Windows SDK (Windows Kits\10\bin\<version>\x64)
fn makeappx() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MAKEAPPX") {
        return Some(PathBuf::from(p));
    }
    let root = Path::new(r"C:\Program Files (x86)\Windows Kits\10\bin");
    let mut found: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path().join(r"x64\makeappx.exe")))
        .filter(|p| p.exists())
        .collect();
    found.sort();
    found.pop()
}
