use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=ui");
    println!("cargo:rerun-if-changed=../../assets");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=../../Cargo.lock");
    println!("cargo:rerun-if-changed=build.rs");

    rerun_on_git_path(&["HEAD"]);
    rerun_on_git_path(&["packed-refs"]);
    if let Some(branch) = git_output(&["symbolic-ref", "--quiet", "HEAD"]) {
        rerun_on_git_path(&[branch.as_str()]);
    }

    copy_assets();

    let sha = git_output(&["rev-parse", "--short=12", "HEAD"])
        .filter(|sha| !sha.is_empty())
        .map(|sha| {
            let dirty = git_output(&["status", "--porcelain", "--untracked-files=normal"])
                .is_some_and(|status| !status.is_empty());
            if dirty { format!("{sha}-dirty") } else { sha }
        })
        .unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=HALATION_BUILD_SHA={sha}");

    // Element debug info lets the headless layout tests find controls; the shipping (release) build omits it.
    let debug_info = std::env::var("PROFILE").is_ok_and(|profile| profile != "release");
    let config = slint_build::CompilerConfiguration::new()
        .embed_resources(slint_build::EmbedResourcesKind::EmbedFiles)
        .with_debug_info(debug_info);
    slint_build::compile_with_config("ui/app.slint", config)
        .expect("the Slint UI must compile; fix the reported .slint diagnostics");
}

/// Development builds run from `target/<profile>`: put a copy of the workspace's `assets/` next to the executable there,
/// as the installer does beside the installed one. Only changed files are copied.
fn copy_assets() {
    let Some(out_dir) = std::env::var_os("OUT_DIR").map(PathBuf::from) else {
        return;
    };
    // OUT_DIR is <target>/<profile>/build/<package>/out
    let Some(profile_dir) = out_dir.ancestors().nth(3) else {
        return;
    };
    let source = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap_or_default())
        .join("../../assets");
    copy_tree(&source, &profile_dir.join("assets"));
}

fn copy_tree(from: &std::path::Path, to: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(from) else {
        return;
    };
    let _ = std::fs::create_dir_all(to);
    for entry in entries.flatten() {
        let (source, target) = (entry.path(), to.join(entry.file_name()));
        if source.is_dir() {
            copy_tree(&source, &target);
            continue;
        }
        let same = match (std::fs::metadata(&source), std::fs::metadata(&target)) {
            (Ok(a), Ok(b)) => a.len() == b.len() && a.modified().ok() <= b.modified().ok(),
            _ => false,
        };
        if !same {
            let _ = std::fs::copy(&source, &target);
        }
    }
}

fn git_output(arguments: &[&str]) -> Option<String> {
    Command::new("git")
        .args(arguments)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|output| output.trim().to_owned())
}

fn rerun_on_git_path(arguments: &[&str]) {
    let Some(path) = git_output(&["rev-parse", "--git-path", arguments[0]]) else {
        return;
    };
    let path = PathBuf::from(path);
    println!("cargo:rerun-if-changed={}", path.display());
}
