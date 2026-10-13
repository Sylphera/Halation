// Test files and tool setup shared by run.js and scan.js.
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const crypto = require("crypto");

const ff = a => execSync(`ffmpeg -hide_banner -loglevel error -y ${a}`);

// Images, songs and the media the fake yt-dlp "downloads", in a fresh folder per test file. FFmpeg makes them once
// per version of this file and FFmpeg build; every later call copies them (tests may write next to their inputs).
function makeFixtures() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "halation-"));
  const FIX = path.join(TMP, "fixtures"), MEDIA = path.join(TMP, "media");
  const cache = cachedFixtures();
  fs.cpSync(path.join(cache, "fixtures"), FIX, { recursive: true });
  fs.cpSync(path.join(cache, "media"), MEDIA, { recursive: true });
  return { TMP, FIX, MEDIA };
}
function cachedFixtures() {
  const key = crypto.createHash("sha1").update(fs.readFileSync(__filename)).update(execSync("ffmpeg -version").toString().split("\n")[0]).digest("hex").slice(0, 12);
  const dir = path.join(os.tmpdir(), "halation-fixtures-" + key);
  if (fs.existsSync(dir)) return dir;
  // made aside and renamed into place: test files started together never see a half-made set
  const tmp = fs.mkdtempSync(dir + "-part-");
  generate(path.join(tmp, "fixtures"), path.join(tmp, "media"));
  try { fs.renameSync(tmp, dir); } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); if (!fs.existsSync(dir)) throw e; }
  return dir;
}
function generate(FIX, MEDIA) {
  fs.mkdirSync(FIX); fs.mkdirSync(MEDIA);
  ff(`-f lavfi -i testsrc2=size=900x900 -frames:v 1 "${FIX}/cover.png"`);
  ff(`-f lavfi -i "gradients=size=700x500:c0=0x0b1a44:c1=0x9dbeff:seed=3" -frames:v 1 "${FIX}/sky.png"`);
  ff(`-f lavfi -i mandelbrot=size=640x640 -frames:v 1 "${FIX}/fractal.png"`);
  ff(`-f lavfi -i testsrc2=size=96x96 -frames:v 1 "${FIX}/small.png"`);
  ff(`-f lavfi -i testsrc2=size=720x720 -frames:v 1 "${FIX}/slow.png"`);
  // a red disc left of centre on blue (800×600): the fake Cutout model's subject, off-centre for the initial crop
  const disc = (a, b) => `'if(lt(hypot(X-260\\,Y-300)\\,170)\\,${a}\\,${b})'`;
  ff(`-f lavfi -i "color=c=black:s=800x600,format=gbrp" -vf "geq=r=${disc(230, 40)}:g=${disc(60, 72)}:b=${disc(50, 200)}" -frames:v 1 "${FIX}/subject.png"`);
  // Synthetic kick: 55 Hz with a 140 bpm envelope, plus a high pad
  ff(`-f lavfi -i "aevalsrc='0.9*sin(2*PI*55*t)*exp(-8*mod(t,0.4286))+0.1*sin(2*PI*880*t)':s=48000:d=3" -ac 2 "${FIX}/song one.wav"`);
  ff(`-f lavfi -i "aevalsrc='0.8*sin(2*PI*50*t)*exp(-6*mod(t,0.5))':s=48000:d=2.5" -ac 2 "${FIX}/song two.wav"`);
  ff(`-f lavfi -i "sine=f=220:d=3" -ac 2 -c:a libopus "${MEDIA}/song.opus"`);
  ff(`-f lavfi -i "sine=f=220:d=3" -ac 2 -c:a libmp3lame "${MEDIA}/song.mp3"`);
  ff(`-f lavfi -i "sine=f=220:d=3" -ac 2 -c:a aac "${MEDIA}/song.m4a"`);
  ff(`-f lavfi -i testsrc2=size=320x180:d=2 -c:v libx264 -pix_fmt yuv420p "${MEDIA}/video.mp4"`);
  // Short video shared by media tests; VP9 is supported by the test browser.
  ff(`-f lavfi -i testsrc=size=1280x720:rate=30:d=4 -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 2M -g 60 "${FIX}/clip720.webm"`);
  ff(`-f lavfi -i testsrc2=size=1280x720 -frames:v 1 "${MEDIA}/thumb.webp"`);
  ff(`-f lavfi -i "gradients=size=1400x1400" -frames:v 1 "${MEDIA}/art.jpg"`);
  ff(`-f lavfi -i "gradients=size=640x640:c0=0x114411:c1=0xeeffee" -frames:v 1 "${MEDIA}/spotify.jpg"`);
  ff(`-f lavfi -i "gradients=size=3000x3000:c0=0x441111:c1=0xffeeee" -frames:v 1 -q:v 8 "${MEDIA}/apple.jpg"`);
}

// What the tools install from, and the web pages and images the Downloader reads
function toolOptions({ MEDIA, TMP }) {
  const T = __dirname;
  const realBin = process.env.UPSCAYL_BIN || "/home/user/upscayl/upscayl-ncnn/build/upscayl-bin";
  const realModels = process.env.UPSCAYL_MODELS || "/home/user/upscayl/models";
  const MODELS = ["upscayl-standard-4x", "digital-art-4x", "ultrasharp-4x", "upscayl-lite-4x"];
  let upscalerSource, real = false;
  if (fs.existsSync(realBin) && MODELS.every(m => fs.existsSync(path.join(realModels, m + ".bin")))) { upscalerSource = { bin: realBin, models: realModels }; real = true; }
  else {
    const models = path.join(TMP, "fake-models"); fs.mkdirSync(models, { recursive: true });
    for (const m of MODELS) for (const e of ["param", "bin"]) fs.writeFileSync(path.join(models, `${m}.${e}`), "x");
    upscalerSource = { bin: path.join(T, "fake-upscayl.js"), models };
  }
  // RIFE: the real rife-ncnn-vulkan when RIFE_BIN and RIFE_MODEL (its rife-v4.6 folder) name them, else the stand-in
  let rifeSource, rifeReal = false;
  if (process.env.RIFE_BIN && process.env.RIFE_MODEL && fs.existsSync(process.env.RIFE_BIN)) { rifeSource = { bin: process.env.RIFE_BIN, model: process.env.RIFE_MODEL }; rifeReal = true; }
  else {
    const model = path.join(TMP, "fake-rife-model"); fs.mkdirSync(model, { recursive: true });
    for (const e of ["param", "bin"]) fs.writeFileSync(path.join(model, `flownet.${e}`), "x");
    rifeSource = { bin: path.join(T, "fake-rife.js"), model };
  }
  const read = f => fs.readFileSync(path.join(MEDIA, f));
  const web = {
    "https://i.ytimg.com/vi/abc123/maxresdefault.webp": read("thumb.webp"),
    // a YouTube Music album whose maxresdefault does not exist (404): sddefault does
    "https://i.ytimg.com/vi/olak1/sddefault.jpg": read("thumb.webp"),
    "https://i1.sndcdn.com/artworks-abc123-large.jpg": read("art.jpg"),
    "https://i1.sndcdn.com/artworks-abc123-original.jpg": read("art.jpg"),
    "https://f4.bcbits.com/img/a1234567890_0.jpg": read("art.jpg"),
    "https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F2gReenRoomNovaLia0fake": JSON.stringify({ title: "Green Room", thumbnail_url: "https://i.scdn.co/image/ab67616d00001e02ff9ca10b55ce82ae553c8228", provider_name: "Spotify" }),
    "https://i.scdn.co/image/ab67616d0000b273ff9ca10b55ce82ae553c8228": read("spotify.jpg"),
    "https://itunes.apple.com/lookup?id=1440857781": JSON.stringify({ resultCount: 1, results: [{ collectionName: "Red Album", artistName: "Nova", artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/source/100x100bb.jpg" }] }),
    "https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/bb/cc/source/3000x3000bb.jpg": read("apple.jpg")
  };
  // Cutout: the real runtime (the npm package) with fake SAM files (tests/fake-sam.py: the "subject" is what is
  // redder than it is blue, each point pushes its own label around it), or the real exports when CUTOUT_DIR names
  // the folder app/scripts/sam21-export.py wrote
  const samFile = f => process.env.CUTOUT_DIR ? path.join(process.env.CUTOUT_DIR, f) : null;
  const fakeEnc = path.join(T, "fake-sam-encoder.onnx"), fakeDec = path.join(T, "fake-sam-decoder.onnx");
  const cutoutSource = { wasm: path.join(T, "..", "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.asyncify.wasm"), model: samFile("sam21-base-plus-encoder-fp16.onnx") || fakeEnc, cpu: samFile("sam21-base-plus-encoder.onnx") || fakeEnc, decoder: samFile("sam21-base-plus-decoder.onnx") || fakeDec, license: path.join(T, "..", "..", "LICENSE") };
  const ffmpegSource = execSync(process.platform === "win32" ? "where.exe ffmpeg" : "command -v ffmpeg").toString().trim().split(/\r?\n/)[0];
  return { real, rifeReal, tools: { upscalerSource, cutoutSource, rifeSource, ytdlpSource: path.join(T, "fake-ytdlp.js"), ffmpegSource, env: { FAKE_YTDLP_MEDIA: MEDIA }, web } };
}

module.exports = { makeFixtures, cachedFixtures, toolOptions };
