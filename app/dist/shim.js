// Bridge between the Visualizer / Grade tabs and Windows: storage, presets as files,
// exports and uploaded resources, all under Documents\Halation.
(() => {
  const P = window.parent !== window ? window.parent : null;
  const T = (P && P.__TAURI__) || window.__TAURI__;
  if (!T || !T.core) return;
  const invoke = T.core.invoke;
  // Servicios de la ventana principal (shell.js): ajustes, fuentes, exportación, otras pestañas…
  const S = window.__hal = (P && P.__hal) || null;
  // Los bytes se crean en el contexto de la ventana principal, que es la que habla con Windows.
  const U8 = P && P.__TAURI__ ? P.Uint8Array : Uint8Array;

  const toBytes = async d => {
    if (d instanceof Blob) return new U8(await d.arrayBuffer());
    if (typeof d === "string") return new U8(new TextEncoder().encode(d).buffer);
    if (d instanceof ArrayBuffer) return new U8(d);
    return new U8(d.buffer, d.byteOffset, d.byteLength);
  };

  // El estado vive en Ajustes\app.json; la copia del navegador no debe pisarlo al arrancar.
  try { localStorage.removeItem("halation-visualizer-v1"); localStorage.removeItem("halation-grade-v1"); } catch (e) {}

  // Nombre de preset → nombre de archivo válido en Windows (misma regla que file_stem en main.rs).
  const fileStem = n => {
    let s = Array.from(String(n).replace(/[\u0000-\u001f\u007f-\u009f\\/:*?"<>|]/g, "-")).slice(0, 120).join("");
    s = s.trim().replace(/[. ]+$/, "");
    if (!s) s = "preset";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s += "_";
    return s;
  };
  const isObj = o => !!o && typeof o === "object" && !Array.isArray(o);
  // Serialización con claves ordenadas: solo se reescribe un archivo si su contenido cambia de verdad.
  const canon = v => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
    : isObj(v) ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
    : JSON.stringify(v === undefined ? null : v);

  // Presets del Visualizer y looks de Grade: un .json por preset en Presets\Visualizer y Presets\Grade.
  const COLL = {
    prefs: {
      state: "visualizer", kind: "visualizer", field: "presets",
      read: o => !isObj(o) ? null : isObj(o.settings) ? o.settings : isObj(o.current) ? o.current : o,
      clean: v => v,
      wrap: v => ({ app: "halation-visualizer", version: 1, settings: v })
    },
    grade: {
      state: "grade", kind: "grade", field: "looks",
      read: o => Array.isArray(o) ? o : isObj(o) && Array.isArray(o.layers) ? o.layers : null,
      clean: v => Array.isArray(v) ? v.map(l => { if (!isObj(l)) return l; const { id, open, mine, ...rest } = l; return rest; }) : v,
      // a personal look (one look layer with its own definition) is version 2 (docs/GRADE_LOOKS_SPEC.md §3.3)
      wrap: v => Array.isArray(v) && v.length === 1 && isObj(v[0]) && v[0].type === "look" && isObj(v[0].def)
        ? { app: "halation-grade", version: 2, kind: "look", base: { id: v[0].id0, rev: v[0].rev || 1 }, layers: v }
        : { app: "halation-grade", version: 1, layers: v }
    }
  };

  const doc = path => {
    const key = String(path).split("/").pop(), C = COLL[key];
    let known = null;                       // nombre de archivo → contenido tal como se leyó o escribió
    const snap = data => ({ id: key, exists: !!data, data: () => data, metadata: { fromCache: false, hasPendingWrites: false } });
    const api = {
      id: key, path,
      async get() {
        if (!C) return snap((await invoke("state_get", { key })) || undefined);
        const [state, files] = await Promise.all([invoke("state_get", { key: C.state }), invoke("preset_list", { kind: C.kind })]);
        const coll = {}, seen = {};
        let newest = 0;
        for (const f of files) {
          let v; try { v = C.read(JSON.parse(f.content)); } catch (e) { v = null; }
          if (v == null) continue;
          v = C.clean(v); coll[f.name] = v; seen[f.name] = canon(v);
          newest = Math.max(newest, f.modified || 0);
        }
        known = seen;
        if (!state && !files.length) return snap(undefined);
        const base = isObj(state) ? state : {};
        return snap(Object.assign({}, base, { [C.field]: coll, updatedAt: Math.max(base.updatedAt || 0, newest) }));
      },
      async set(obj) {
        if (!C) { await invoke("state_set", { key, value: obj }); return; }
        const rest = Object.assign({}, obj), coll = rest[C.field];
        delete rest[C.field];
        await invoke("state_set", { key: C.state, value: rest });
        if (!isObj(coll)) return;
        const next = {};
        let touched = false;
        for (const name in coll) {
          const stem = fileStem(name), v = C.clean(coll[name]), s = canon(v);
          next[stem] = s;
          if (!known || known[stem] !== s) { await invoke("preset_write", { kind: C.kind, name: stem, content: JSON.stringify(C.wrap(v), null, 2) }); touched = true; }
        }
        if (known) for (const stem in known) if (!(stem in next)) { await invoke("preset_delete", { kind: C.kind, name: stem }); touched = true; }
        known = next;
        if (touched && S) S.presetsWritten(C.kind);
      },
      async update(obj) { const s = await api.get(); await api.set(Object.assign(s.data() || {}, obj)); },
      async delete() { await api.set({}); },
      onSnapshot() { return () => {}; }
    };
    return api;
  };
  const db = { doc };

  const user = {
    id: async () => "local", isOwner: async () => true, canEdit: async () => true, can: async () => true,
    me: async () => ({ id: "local", name: "", email: null, isOwner: true, canEdit: true, avatarUrl: "", color: "#9dbeff" }),
    profiles: async () => ({}), name: async () => "", search: async () => []
  };

  // All exports, including batches, follow the shell's global destination policy.
  const downloads = {
    async save({ filename, data, direct }) {
      const blob = new Blob([await toBytes(data)]);
      const path = await S.saveOutput(blob, filename);
      if (!path) throw { code: "declined", cancelled: true, message: window.t("common.saveCancelled") };
      return { status: "saved", path, name: String(path).split(/[\\/]/).pop() };
    }
  };

  // Fuentes y logos subidos: Recursos\Fuentes y Recursos\Logos
  const EXT = { "font/ttf": "ttf", "font/otf": "otf", "font/woff": "woff", "font/woff2": "woff2", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
  const assets = {
    async upload(blob, opts) {
      const type = (opts && opts.type) || blob.type || "application/octet-stream";
      const headers = { "x-ext": EXT[type] || "bin", "x-name": encodeURIComponent(blob.name || "") };
      const id = await invoke("asset_put", await toBytes(blob), { headers });
      return { id, url: URL.createObjectURL(blob), sizeBytes: blob.size, contentType: type };
    },
    async delete(id) { return { deleted: await invoke("asset_delete", { id }) }; },
    async list() { return { assets: [], usage: { files: 0, bytes: 0, maxFiles: 0, maxBytes: 0 } }; }
  };
  window.__halBlob = async id => {
    try { return new Response(await invoke("asset_get", { id })); }
    catch (e) { return new Response(null, { status: 404 }); }
  };

  const caps = { db, user, downloads, assets };
  window.__caps = { use: async name => caps[name] || null };

  // Fuentes instaladas en Windows (se piden una sola vez para todas las pestañas)
  window.__halFonts = (P && P.__halFonts) || invoke("list_fonts").catch(() => []);

  // Varios archivos arrastrados (o un audio sobre Grade): los reparte la ventana principal.
  // Imágenes → Grade, audios → Visualizer. Un solo archivo propio lo sigue abriendo esta pestaña.
  const TAB = /grade/.test(location.pathname) ? "grade" : "visualizer";
  const isAudio = f => /^audio\//.test(f.type) || /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?)$/i.test(f.name);
  window.addEventListener("drop", e => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!S || !files || !files.length) return;
    const list = Array.from(files);
    if (list.length < 2 && !(TAB === "grade" && list.some(isAudio))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    // Un «drop» vacío para que la herramienta quite su aviso de «suelta aquí».
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: new DataTransfer(), cancelable: true }));
    S.routeFiles(list);
  }, true);
})();
