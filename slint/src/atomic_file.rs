use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write `bytes` to `path` through a uniquely named temporary file in the same directory.
///
/// The destination is replaced only after the temporary file has been flushed. On failure the
/// temporary file is removed and the previous destination is left untouched.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temp = write_temp(path, bytes)?;
    let result = fs::rename(&temp, path);

    if result.is_err() {
        // Cleanup must not replace the original write/rename error.
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Atomically create a new destination without replacing a path created by another writer.
///
/// This is used by Settings reset after the old file was moved to its preserved backup. Creating
/// a hard link from the flushed sibling temp file fails if `path` appeared concurrently.
pub fn write_atomic_new(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temp = write_temp(path, bytes)?;
    let result = fs::hard_link(&temp, path);
    // Once linked, the destination is committed; temp unlink is cleanup only.
    let _ = fs::remove_file(&temp);
    result
}

fn write_temp(path: &Path, bytes: &[u8]) -> std::io::Result<std::path::PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no file name")
    })?;
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(
        ".{}.tmp-{}-{counter}",
        file_name.to_string_lossy(),
        std::process::id()
    ));

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let result = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        // Cleanup must not replace the original write error.
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(temp)
}
