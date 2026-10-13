#!/usr/bin/env python3
"""Tests the real executable (Linux, WebKitGTK under Xvfb): one-time import of data from earlier versions,
"Open with" through arguments and the remembered window size. Usage: python3 app/tests/realapp.py [binary path]"""
import json, os, re, shutil, subprocess, sys, tempfile, time
from Xlib import X, display, protocol

BIN = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "src-tauri", "target", "debug", "halation"))
fails = 0

def ok(c, msg):
    global fails
    print(("OK   " if c else "FAIL ") + msg)
    if not c: fails += 1

def until(fn, secs=25):
    t = time.time()
    while time.time() - t < secs:
        try:
            v = fn()
            if v: return v
        except Exception:
            pass
        time.sleep(0.25)
    return False

home = tempfile.mkdtemp(prefix="halation-real-")
os.makedirs(f"{home}/.config")
with open(f"{home}/.config/user-dirs.dirs", "w") as f: f.write('XDG_DOCUMENTS_DIR="$HOME/Docs"\n')
# The earlier folder names are declared once, in the migration code (migrate.rs).
MAIN_RS = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src-tauri", "src", "migrate.rs"), encoding="utf8").read()
const = lambda name: re.search(rf'const {name}: &str = "([^"]+)";', MAIN_RS).group(1)
# Earliest layout: Documents\<FIRST_LAYOUT>\Visualizer\prefs.json, Grade\grade.json, recursos\
first = f"{home}/Docs/{const('FIRST_LAYOUT')}"
os.makedirs(f"{first}/Visualizer/recursos"); os.makedirs(f"{first}/Grade")
json.dump({"current": {"coverSize": 66}, "presets": {"Blue wave": {"coverSize": 70}, "Shorts 9:16": {"format": "1080x1920"}}, "fonts": [], "updatedAt": 1}, open(f"{first}/Visualizer/prefs.json", "w"))
json.dump({"looks": {"My blue": [{"id": "x", "type": "look", "id0": "nocturno", "on": True, "amt": 80, "open": True}]}, "previewPct": 60, "current": {"layers": [], "crop": {"aspect": "orig", "x": 0, "y": 0}}, "updatedAt": 1}, open(f"{first}/Grade/grade.json", "w"))
open(f"{first}/Visualizer/recursos/18a3f.otf", "wb").write(b"font")
# Previous layout: Documents\<PREVIOUS> with Spanish folder names
prev = f"{home}/Docs/{const('PREVIOUS')}"
for d in ["Presets/Visualizer", "Presets/Grade", "Exportados/Videos", "Exportados/Portadas", "Recursos/Fuentes", "Recursos/Logos", "Ajustes"]: os.makedirs(f"{prev}/{d}")
json.dump({"app": "old-visualizer", "version": 1, "settings": {"coverSize": 55}}, open(f"{prev}/Presets/Visualizer/Studio night.json", "w"))
json.dump({"app": "old-visualizer", "version": 1, "settings": {"coverSize": 99}}, open(f"{prev}/Presets/Visualizer/Blue wave.json", "w"))
json.dump({"app": "old-grade", "version": 1, "layers": [{"id": "y", "type": "look", "id0": "hielo", "on": True, "amt": 50}]}, open(f"{prev}/Presets/Grade/Ice.json", "w"))
open(f"{prev}/Recursos/Logos/logo1.png", "wb").write(b"png")
open(f"{prev}/Exportados/Videos/old video.mp4", "wb").write(b"mp4")
open(f"{prev}/Exportados/Portadas/old cover.png", "wb").write(b"png")
json.dump({"settings": {"saveMode": "ask", "videoFps": "60"}, "fontFavorites": ["Syne"], "exports": [{"path": "x"}], "studio": {"tab": "grade"}}, open(f"{prev}/Ajustes/app.json", "w"))
fx = f"{home}/fixtures"; os.makedirs(fx)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=55:d=2", f"{fx}/new song.wav"], check=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=300x300", "-frames:v", "1", f"{fx}/cover.png"], check=True)
base = f"{home}/Docs/Halation"
state = lambda: json.load(open(f"{base}/Settings/app.json"))

xvfb = subprocess.Popen(["Xvfb", ":77", "-screen", "0", "1920x1080x24"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
env = dict(os.environ, HOME=home, DISPLAY=":77", XDG_CONFIG_HOME=f"{home}/.config", NO_AT_BRIDGE="1")
dpy = display.Display(":77")

def find_window():
    def walk(w):
        try:
            if w.get_wm_name() == "Halation" and w.get_attributes().map_state == X.IsViewable: return w
        except Exception:
            return None
        for c in w.query_tree().children:
            r = walk(c)
            if r: return r
        return None
    return walk(dpy.screen().root)

def close(w):
    ev = protocol.event.ClientMessage(window=w, client_type=dpy.intern_atom("WM_PROTOCOLS"), data=(32, [dpy.intern_atom("WM_DELETE_WINDOW"), X.CurrentTime, 0, 0, 0]))
    w.send_event(ev); dpy.flush()

def launch(*args):
    return subprocess.Popen([BIN, *args], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

try:
    # 1) first start with an audio file as argument ("Open with")
    p = launch(f"{fx}/new song.wav")
    ok(until(lambda: os.path.exists(f"{base}/Settings/app.json") and "migrated" in state()), "First start: folder layout and import")
    ok(all(os.path.isdir(f"{base}/{d}") for d in ["Presets/Visualizer", "Presets/Grade", "Exports/Videos", "Exports/Covers", "Exports/Upscaled", "Downloads/Video", "Downloads/Audio", "Downloads/Covers", "Resources/Fonts", "Resources/Logos", "Tools", "Settings"]), "Folders: Presets, Exports (Videos, Covers, Upscaled), Downloads (Video, Audio, Covers), Resources, Tools, Settings")
    m = state()["migrated"]
    ok(len(m["from"]) == 2, f"Import from both earlier layouts: {m['from']}")
    ok(sorted(os.listdir(f"{base}/Presets/Visualizer")) == ["Blue wave.json", "Shorts 9-16.json", "Studio night.json"], "Import: one .json per Visualizer preset from both layouts")
    ok(json.load(open(f"{base}/Presets/Visualizer/Blue wave.json"))["settings"]["coverSize"] == 99, "Import: the newer layout wins when names clash")
    ok(json.load(open(f"{base}/Presets/Visualizer/Studio night.json"))["app"] == "halation-visualizer", "Import: preset files are rewritten for Halation")
    ok(sorted(os.listdir(f"{base}/Presets/Grade")) == ["Ice.json", "My blue.json"] and "id" not in json.load(open(f"{base}/Presets/Grade/Ice.json"))["layers"][0], "Import: Grade looks without internal ids")
    ok(os.path.exists(f"{base}/Resources/Fonts/18a3f.otf") and os.path.exists(f"{base}/Resources/Logos/logo1.png"), "Import: fonts and logos copied")
    ok(until(lambda: os.path.exists(f"{base}/Exports/Videos/old video.mp4") and os.path.exists(f"{base}/Exports/Covers/old cover.png")), "Import: videos and covers copied to Exports")
    st = state()
    ok(st["settings"]["saveMode"] == "ask" and st["settings"]["videoFps"] == "60" and st.get("fontFavorites") == ["Syne"] and "exports" not in st, "Import: settings and favorites kept, stale export list dropped")
    ok(m["presets"] == 3 and m["looks"] == 2 and m["resources"] == 2 and m["exports"] == 2, f"Import counts: {m}")
    ok(os.path.exists(f"{first}/Visualizer/prefs.json") and os.path.exists(f"{prev}/Ajustes/app.json"), "The earlier folders are left untouched")
    # the app records what it opened, and in which tab, as the first recent file on Home
    recent = lambda: (state().get("recent") or [{}])[0]
    ok(until(lambda: recent().get("tab") == "visualizer" and recent().get("kind") == "audio"), "\"Open with\" an audio file opens the Visualizer tab")
    w = until(find_window)
    ok(bool(w), "Window visible with the title Halation")
    w.configure(x=140, y=90, width=1300, height=820); dpy.sync(); time.sleep(1.0)
    close(w)
    ok(until(lambda: p.poll() is not None, 15), "Closing the window ends the program")
    ws = state().get("window", {})
    ok(abs(ws.get("width", 0) - 1300) <= 2 and abs(ws.get("height", 0) - 820) <= 2 and ws.get("maximized") is False, f"Size saved on close: {ws}")

    # 2) second start with an image: Grade and restored window, no second import
    os.remove(f"{prev}/Presets/Visualizer/Studio night.json")
    p = launch(f"{fx}/cover.png")
    ok(until(lambda: recent().get("tab") == "grade" and recent().get("name") == "cover.png"), "\"Open with\" an image opens the Grade tab")
    w = until(find_window)
    g = w.get_geometry() if w else None
    ok(bool(g) and abs(g.width - 1300) <= 2 and abs(g.height - 820) <= 2, f"The window gets its size back: {g.width if g else '?'}×{g.height if g else '?'}")
    ok(state()["migrated"]["at"] == m["at"], "The import runs only once")
    if w: close(w)
    until(lambda: p.poll() is not None, 15)

    # 3) streaming export through the real IPC and encode.rs (tests/selftest-encode.js)
    p = subprocess.Popen([BIN], env=dict(env, HALATION_SELFTEST=os.path.join(os.path.dirname(os.path.abspath(__file__)), "selftest-encode.js")), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    st3 = until(lambda: state().get("selftest"), 90) or {}
    ok(st3 and not st3.get("errors"), f"Self-test in the real app ran without errors: {st3.get('errors')}")
    files = st3.get("files", {})
    def probe(f, extra=()):
        r = subprocess.run(["ffprobe", "-v", "error", *extra, "-count_frames", "-show_entries", "stream=codec_name,pix_fmt,nb_read_frames,width,height,sample_rate", "-of", "json", f], capture_output=True, text=True)
        return (json.loads(r.stdout or "{}").get("streams") or [{}])[0]
    for fmt, codec, pix in [("prores4444", "prores", "yuva444p"), ("webm", "vp9", "yuv"), ("h264", "h264", "yuv420p")]:
        info = probe(files.get(fmt, {}).get("path", "/missing"))
        ok(info.get("codec_name") == codec and info.get("pix_fmt", "").startswith(pix) and info.get("nb_read_frames") == "10" and info.get("width") == 64, f"encode.rs → {fmt}: {info}")
    seq = files.get("png", {}).get("path", "/missing")
    ok(os.path.isdir(seq) and sorted(os.listdir(seq))[:2] == ["00001.png", "00002.png"] and len(os.listdir(seq)) == 10, "encode.rs → PNG sequence: 10 numbered images in a folder")
    def rgba(f, n):
        r = subprocess.run(["ffmpeg", "-v", "error", "-i", f, "-vf", f"select=eq(n\\,{n})", "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], capture_output=True)
        return r.stdout
    px = lambda b, x, y: tuple(b[(y * 64 + x) * 4:(y * 64 + x) * 4 + 4])
    f1 = rgba(files.get("prores4444", {}).get("path", "/missing"), 1)
    ok(len(f1) == 64 * 48 * 4 and px(f1, 2, 2)[3] < 3 and px(f1, 30, 20)[3] > 250 and px(f1, 30, 20)[1] > 180, f"A rectangle lands on a transparent frame: outside {px(f1, 2, 2) if f1 else '?'}, inside {px(f1, 30, 20) if f1 else '?'}")
    f3, f4 = rgba(files.get("prores4444", {}).get("path", "/missing"), 3), rgba(files.get("prores4444", {}).get("path", "/missing"), 4)
    ok(f3 and f3 == f4, "A repeated frame (x-same) is the previous frame again")
    wi = probe(files.get("wav", {}).get("path", "/missing"))
    ok(wi.get("codec_name") == "pcm_s24le" and wi.get("sample_rate") == "48000", f"encode.rs → WAV 24-bit: {wi}")
    ok(st3.get("cancelledPath") and not os.path.exists(st3["cancelledPath"]), "Abort kills FFmpeg and removes the partial file")
    ok("does not fit" in (st3.get("badRect") or ""), f"A rectangle outside the frame is refused: {st3.get('badRect')}")
    ok((st3.get("free") or 0) > 0 and st3.get("removed") is True and not os.path.exists(st3.get("removedPath", "/")), f"Free space ({(st3.get('free') or 0) / 1e9:.1f} GB) and removing an export folder")
    ok(os.path.basename(st3.get("dir", "")) == "selftest - layers" and os.path.dirname(st3.get("dir", "")) == f"{base}/Exports/Videos", "Export folders go to Exports/Videos")
    w = until(find_window)
    if w: close(w)
    until(lambda: p.poll() is not None, 15)
finally:
    for proc in [p]:
        if proc.poll() is None: proc.kill()
    xvfb.kill()
    shutil.rmtree(home, ignore_errors=True)
print("\n" + (f"{fails} failed" if fails else "All passed"))
sys.exit(1 if fails else 0)
