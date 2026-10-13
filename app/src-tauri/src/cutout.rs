//! Cutout (removing the background): its downloadable component and its cache.
//! The model runs in the page (ONNX Runtime Web in a worker, dist/cutout-worker.js); this side only downloads
//! the runtime's WebAssembly and the models to Documents\Halation\Tools\cutout, and keeps the model's masks by
//! image hash in the workspace's "masks" area so the same picture is never analysed twice.
//! Model: SAM 2.1 Base+ (Meta, Apache-2.0, https://github.com/facebookresearch/sam2), Meta's checkpoint exported by
//! app/scripts/sam21-export.py: the image encoder in half precision for WebGPU and in float32 for the CPU, and the
//! prompt decoder (points and the last mask in, mask logits out). The files are published as assets of the release
//! MODEL_TAG of the public repository, with the model's licence (MODEL_LICENSE, kept beside them); the script's
//! --install puts the same files in the folder for a local test without the release.
//! Runtime: onnxruntime-web (MIT); its version must match the bundle in dist/onnxruntime.js.

use crate::{paths::*, tools::tools_dir};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};
use tauri::{ipc::Response, AppHandle};

pub(crate) const ORT_VERSION: &str = "1.30.0";
pub(crate) const WASM_FILE: &str = "ort-wasm-simd-threaded.asyncify.wasm";
pub(crate) const MODEL_FILE: &str = "sam21-base-plus-encoder-fp16.onnx";
pub(crate) const CPU_MODEL_FILE: &str = "sam21-base-plus-encoder.onnx";
pub(crate) const DECODER_FILE: &str = "sam21-base-plus-decoder.onnx";
pub(crate) const MODEL_LICENSE: &str = "SAM2-LICENSE.txt";
const MODEL_TAG: &str = "cutout-sam21-v1";
/// What the earlier models left in the folder (U²-Net, BiRefNet)
const OLD_FILES: [&str; 4] = ["u2net.onnx", "birefnet-general-fp16.onnx", "birefnet-lite.onnx", "BiRefNet-LICENSE.txt"];

fn wasm_url() -> String {
    format!("https://cdn.jsdelivr.net/npm/onnxruntime-web@{ORT_VERSION}/dist/{WASM_FILE}")
}
fn model_url(file: &str) -> String {
    format!("https://github.com/Sylphera/Halation/releases/download/{MODEL_TAG}/{file}")
}

pub(crate) fn cutout_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(tools_dir(app)?.join("cutout"))
}

/// {dir, wasm, model, cpu, decoder} when the runtime and the three model files are there
pub(crate) fn find_cutout(app: &AppHandle) -> Option<Value> {
    let d = cutout_dir(app).ok()?;
    let (w, m, c, k) = (d.join(WASM_FILE), d.join(MODEL_FILE), d.join(CPU_MODEL_FILE), d.join(DECODER_FILE));
    (w.is_file() && m.is_file() && c.is_file() && k.is_file()).then(|| {
        json!({ "dir": d.to_string_lossy(), "wasm": w.to_string_lossy(), "model": m.to_string_lossy(), "cpu": c.to_string_lossy(), "decoder": k.to_string_lossy() })
    })
}

/// The runtime, the models and their licence, the ones not there yet; the earlier models' files go.
pub(crate) fn install_cutout(app: &AppHandle) -> Result<(), String> {
    let d = cutout_dir(app)?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    for old in OLD_FILES {
        let _ = fs::remove_file(d.join(old));
    }
    for (file, url) in [
        (WASM_FILE, wasm_url()),
        (MODEL_LICENSE, model_url(MODEL_LICENSE)),
        (DECODER_FILE, model_url(DECODER_FILE)),
        (CPU_MODEL_FILE, model_url(CPU_MODEL_FILE)),
        (MODEL_FILE, model_url(MODEL_FILE)),
    ] {
        let dest = d.join(file);
        if !dest.is_file() {
            crate::workspace::fetch_model(app, "cutout", &url, &dest)?;
        }
    }
    Ok(())
}

/* ---------- cache of the model's masks ---------- */
// The workspace's "masks" area (workspace.rs), under its one budget.

/// The cached mask for `key` (a model name and a hash), or nothing (an empty answer)
#[tauri::command]
pub fn cutout_cache_get(app: AppHandle, ws: tauri::State<'_, crate::workspace::Workspace>, key: String) -> Result<Response, String> {
    Ok(Response::new(crate::workspace::get(&app, &ws, "masks", &key)?))
}

#[tauri::command]
pub fn cutout_cache_put(app: AppHandle, ws: tauri::State<'_, crate::workspace::Workspace>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    crate::workspace::put(&app, &ws, "masks", &header(&request, "x-key"), raw_body(&request)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_url_matches_the_bundled_version() {
        assert_eq!(wasm_url(), "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.asyncify.wasm");
        let bundle = include_str!("../../dist/onnxruntime.js");
        assert!(bundle.contains(&format!("ONNX Runtime Web v{ORT_VERSION}")));
        assert!(bundle.contains(WASM_FILE), "the bundle loads another WebAssembly build");
    }

    #[test]
    fn models_come_from_the_public_release() {
        assert_eq!(model_url(MODEL_FILE), "https://github.com/Sylphera/Halation/releases/download/cutout-sam21-v1/sam21-base-plus-encoder-fp16.onnx");
        assert!(model_url(CPU_MODEL_FILE).ends_with("/cutout-sam21-v1/sam21-base-plus-encoder.onnx"));
        assert!(model_url(DECODER_FILE).ends_with("/cutout-sam21-v1/sam21-base-plus-decoder.onnx"));
        for f in [MODEL_FILE, CPU_MODEL_FILE, DECODER_FILE, MODEL_LICENSE] {
            assert!(!OLD_FILES.contains(&f));
        }
    }

    #[test]
    fn cache_keys_cannot_leave_the_folder() {
        use crate::workspace::valid_key;
        assert!(valid_key("sam21-0123456789abcdef0123456789abcdef01234567"));
        for k in ["", "../x", "a/b", "a.png", "a b", &"x".repeat(57)] {
            assert!(!valid_key(k), "{k}");
        }
    }
}
