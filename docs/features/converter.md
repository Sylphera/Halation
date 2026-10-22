# Converter — Especificación v1 y v2

Status: Planned — not ported to the native app; implemented in the Tauri app on `main`.

Save/export destinations now follow [the global save & export policy](save-location.md). This supersedes the tool-specific destination preferences and first-export folder prompt described below; processing and format behavior is unchanged.

Herramienta para convertir archivos de forma deliberadamente simple: **archivo → formato → Convert**. La v1 cubre
audio, vídeo e imagen con FFmpeg (ya es componente de Halation) y librerías Rust para imagen. Los documentos
(LibreOffice, Pandoc) son la v2. Base: idea de Java y propuesta del coordinador (2026-10-07), `tools.rs`,
`encoder.js`, `THIRD_PARTY.md`, `LICENSE` 1.1. Propuesta sin código. **[C]** comprobado (código, documentación
oficial o fuente citada) · **[I]** inferido.

Prioridad: aparcada detrás de Vocal Remover.

---

## 0. Principios

1. **Sin matrices.** Ni pestañas por tipo, ni presets de calidad, ni controles por códec. Un selector de formato.
2. **El motor es invisible.** El usuario nunca elige motor; la interfaz no lo nombra (sí la ficha de licencias).
3. **Lista curada.** Las salidas salen de una tabla propia por clase de entrada (§3). El motor instalado solo decide
   si una opción aparece, nunca añade opciones.
4. **Copiar antes que recodificar.** Si los flujos caben en el contenedor de destino, se copian sin tocar
   (instantáneo, sin pérdida).
5. **Detección por contenido.** La extensión solo es pista; manda lo que dicen los bytes y ffprobe.
6. **Valores fijos y sensatos.** Cada caso donde el formato obliga a decidir (transparencia → JPG, vídeo → GIF…)
   tiene un valor fijo documentado (§4), sin control.
7. **El original no se toca nunca.** Ni se sobrescribe ni se borra.

---

## 1. Distribución de la pestaña

Interfaz rediseñada con Java (07-10): sustituye al bloque único de la v1.

Estado inicial: zona de soltar arriba ("Drop any file": archivos, carpeta, Library, Send to…) y debajo seis botones
por tipo: Video, Audio, Image, Documents, Spreadsheets & presentations, PDF. Cada uno muestra sus formatos y abre el
explorador filtrado a ese tipo (`convert_pick` con `kind`; "All files" sigue a un clic en el diálogo).

Un archivo: dos columnas.

```
┌───────────────────────────────┐ ┌──────────────────────────────────┐
│                               │ │ [mini] vacaciones.mkv   [Change] │
│        vista previa           │ │        Video · H.264 + AAC · …   │
│                               │ │ Convert to                       │
│                               │ │ (•) MP4            [Recommended] │
│                               │ │ ( ) WEBM                         │
│                               │ │ ( ) MOV …                        │
│                               │ │ ▸ Audio only                     │
│                               │ │ Copies streams · no quality loss │
│                               │ │ Save to   Exports\Converted ▾    │
│                               │ │ [██████ Converting… 42 % ──────] │
└───────────────────────────────┘ └──────────────────────────────────┘
```

- **Vista previa**: imagen tal cual; vídeo con reproductor si la ventana lo decodifica (H.264/VP8/VP9/AV1 en
  MP4/WebM/MOV hasta 150 MB), si no su primer fotograma; audio (formatos comunes hasta 80 MB); PDF su
  primera página (`convert_pdf_preview`, con PDFium); el audio con reproductor propio (onda en la que se pulsa o arrastra para moverse, decodificado con Web Audio); DOCX, hojas y presentaciones un icono grande con nombre y datos.
- **Tipo detectado** en una línea: clase + lo esencial (códecs, tamaño, duración, páginas/fotogramas).
- **Convert to** como lista: solo las salidas válidas (§3), la **recomendada primero** con su insignia: una copia
  sin pérdida si existe; si no MP4 (vídeo), MP3 (audio), PNG (imagen), PDF (documentos). En vídeo, las cinco salidas
  de solo audio plegadas bajo "Audio only". Debajo, la línea de consecuencia (§4.5).
- Debajo de cada formato, una línea con lo que da: calidad y ajustes fijos (los de convert.rs, sin controles) y para qué
  sirve, p. ej. "Lossy · VBR about 245 kbps (V0) · plays everywhere" (`cv.d.<tipo>.<formato>`; Java, 2026-10-07).
- **Save to**: `Exports\Converted\` por defecto; "Next to the original" y "Choose folder…". Se recuerda.
- Botón **Convert** ancho: su relleno es la barra de progreso (% real; `motion.js`) y su texto el %. Al terminar:
  **Open folder**, **Send to…** ▾, y el tamaño antes → después.
- Archivo sin salidas: una línea ("Halation can't convert this file yet") y sin lista.
- Varios archivos: a la izquierda la lista agrupada por tipo; a la derecha el mismo panel con una elección por grupo
  (chips). §6.

---

## 2. Detección

Orden (en Rust, `convert.rs`):

1. **Firma de bytes** (primeros 64 B): PNG, JPEG, GIF, WEBP (RIFF…WEBP), BMP, TIFF, ICO, QOI, TGA (por extensión,
   no tiene firma), AVIF/HEIC (caja `ftyp` con marca `avif`/`heic`/`mif1`), PDF, ZIP/OOXML, etc.
   `image::guess_format` cubre las de imagen [C, crate `image` 0.25].
2. **ffprobe** para todo lo que no sea imagen fija conocida: `-show_streams -show_format -of json`
   (`find_ffprobe` ya existe en `tools.rs`).
3. **Clasificación** en una de estas clases:

| Clase | Regla |
|---|---|
| `image` | Imagen fija de la lista de §3.1 |
| `animated` | GIF o WEBP con más de un fotograma |
| `audio` | ffprobe: ≥ 1 flujo de audio, ningún vídeo "real" (una portada `attached_pic` no cuenta) |
| `video` | ffprobe: ≥ 1 flujo de vídeo que no es `attached_pic` |
| `unsupported` | Nada de lo anterior (documentos en v1, archivos, binarios…) |

- Si la extensión contradice al contenido (un `.mp3` que es WAV), manda el contenido y el tipo detectado lo dice:
  "Audio · WAV (named .mp3)".
- Sin FFmpeg instalado: se detectan y convierten imágenes; audio/vídeo muestran el aviso de componente de siempre
  ("Needs FFmpeg · Install") en la propia tarjeta.

---

## 3. Tabla curada entrada → salidas

El orden de cada fila es el orden del selector; la primera es la sugerida (preseleccionada) salvo que coincida con
el formato de entrada, en cuyo caso se salta a la siguiente. El formato igual al de entrada no se ofrece.

### 3.1 Imagen fija (`image`)

Entradas v1: PNG, JPEG, WEBP, GIF (1 fotograma), BMP, TIFF, ICO, TGA, QOI, AVIF [I: decodificación vía FFmpeg,
§5.2], HEIC/HEIF → pregunta abierta (§13).

| Salida | Motor | Notas |
|---|---|---|
| PNG | Rust `image` | Sin pérdida |
| JPG | Rust `image` | Transparencia → blanco (§4.1) |
| WEBP | Rust `webp` (libwebp) | Con pérdida q 90; sin pérdida si la entrada es PNG con ≤ 256 colores [I: criterio] |
| TIFF | Rust `image` | |
| BMP | Rust `image` | |
| ICO | Rust `image` | Varias medidas (§4.1) |
| GIF | Rust `image` | 256 colores |

Fuera de la v1 como salida: AVIF (codificación lenta; §12), HEIC.

### 3.2 Imagen animada (`animated`)

| Salida | Motor | Notas |
|---|---|---|
| MP4 | FFmpeg | H.264, sin audio |
| WEBM | FFmpeg | VP9 con alfa si lo hay |
| GIF / WEBP | FFmpeg | El que no sea la entrada; WEBP animado con `libwebp_anim` [I: presente en el build] |
| PNG | Rust `image` | "Only the first frame" |

### 3.3 Audio (`audio`)

| Salida | Códec | Copia si la entrada ya es… |
|---|---|---|
| MP3 | libmp3lame | MP3 |
| M4A | AAC (encoder nativo de FFmpeg) | AAC o ALAC |
| FLAC | flac | FLAC |
| WAV | PCM | PCM |
| OGG | Vorbis (libvorbis) | Vorbis |
| OPUS | libopus | Opus |
| AIFF | PCM big-endian | PCM |

### 3.4 Vídeo (`video`)

| Salida | Vídeo | Audio | Copia si… |
|---|---|---|---|
| MP4 | H.264 (libx264) | AAC | vídeo H.264/HEVC/AV1 y audio AAC/MP3/AC-3/Opus [C: admitidos por el muxer `mp4` de FFmpeg; Opus en MP4 es válido pero de soporte irregular en reproductores → [I] se recodifica a AAC] |
| MKV | (copia siempre que pueda) | (copia) | casi siempre: MKV admite prácticamente todo |
| WEBM | VP9 (libvpx-vp9) | Opus | vídeo VP8/VP9/AV1 y audio Vorbis/Opus |
| MOV | H.264 | AAC | igual que MP4 más ProRes/PCM |
| GIF | paleta | — | nunca (§4.4) |
| **Audio:** MP3 · M4A · FLAC · WAV · OPUS | — | §3.3 | el audio se copia si coincide (AAC → M4A, Opus → OPUS) |

- Las salidas de audio aparecen en el mismo selector bajo un separador "Audio only".
- Imagen de un vídeo: no está aquí; "Send to → Frame Capture" ya cubre eso.

### 3.5 Componente que falta

Si un códec de la tabla no está en el FFmpeg instalado (`ffmpeg -hide_banner -encoders`, leído una vez y cacheado
por ruta+mtime del binario), esa salida no aparece. Con el build actual se espera que estén todos [I] (§9.1);
un FFmpeg del PATH puede ser más pobre.

---

## 4. Valores por defecto

Fijos, sin control. Los números son el punto de partida para la implementación; cambiarlos es editar una tabla.

### 4.1 Imagen

| Caso | Valor |
|---|---|
| Orientación EXIF | Se aplica al píxel y la salida queda sin rotación pendiente |
| Perfil ICC | Se conserva en PNG, JPG, WEBP y TIFF; en BMP/GIF/ICO se convierte a sRGB antes (moxcms ya está en el árbol de `image`) [I: API exacta por confirmar] |
| Metadatos EXIF | Se conservan en salidas que los admiten (JPG, WEBP, TIFF, PNG) salvo GPS, que se quita [I: propuesta; ver §13] |
| Transparencia → JPG / BMP 24 bit | Fondo blanco |
| JPG | Calidad 90, 4:2:0, progresivo no |
| WEBP | Con pérdida q 90 (`webp` crate); sin pérdida si la entrada es PNG paletizado |
| PNG | Compresión por defecto del crate; 16 bit se mantiene |
| TIFF | Sin pérdida (LZW o Deflate según admita el encoder del crate) [I] |
| BMP | 24 bit; 32 bit si hay alfa |
| ICO | Cuadrado (lienzo transparente centrado si no lo es), medidas 16, 32, 48, 256 |
| GIF fijo | Cuantización NeuQuant a 256 colores; alfa binaria |
| Imagen > 16 384 px de lado o > 512 MB descomprimida | Error claro, no se intenta |

### 4.2 Audio

| Caso | Valor |
|---|---|
| MP3 | VBR `-q:a 0` (~245 kbps); frecuencia > 48 kHz → 48 kHz |
| M4A (AAC) | 256 kbps |
| OGG | Vorbis `-q:a 6` |
| OPUS | 160 kbps, 48 kHz (lo exige Opus) |
| FLAC / WAV / AIFF | Profundidad de origen (16 o 24; float → 24 bit); FLAC nivel 5 |
| Canales | Se mantienen; más de 2 en MP3 → mezcla estéreo (LAME no admite más) |
| Etiquetas y portada | Se copian (`-map_metadata 0`; portada en MP3, M4A, FLAC) |
| Lossy → lossless | Se permite sin aviso bloqueante; línea "Won't improve quality" |

### 4.3 Vídeo

| Caso | Valor |
|---|---|
| Copia | `-c copy` de todos los flujos que caben; los que no, se recodifican solo ellos |
| H.264 | `libx264 -crf 18 -preset medium -pix_fmt yuv420p -movflags +faststart` (como `encoder.js`) |
| VP9 | `-crf 31 -b:v 0 -row-mt 1 -deadline good` |
| AAC / Opus | 192 kbps / 160 kbps |
| Pistas de audio | Todas, con su idioma |
| Subtítulos de texto | Se pasan (MP4/MOV → `mov_text`, WEBM → WebVTT); de imagen (PGS/VobSub) a MP4/WEBM se descartan con línea de aviso |
| Adjuntos (fuentes de MKV), capítulos | Capítulos se copian; adjuntos solo a MKV |
| Resolución, fps | Se mantienen; fps variable se mantiene (`-fps_mode passthrough`) |
| Origen HDR (PQ/HLG, 10 bit) a H.264 8 bit | Se convierte sin mapeo de tonos y se avisa "HDR source: colors may look flat"; mapeo correcto en §12 |
| Aceleración por hardware | No (ROADMAP ya la recoge) |

### 4.4 Vídeo → GIF

- 15 fps, ancho máximo 480 px (alto proporcional, nunca se amplía).
- Dos pasadas `palettegen=stats_mode=diff` + `paletteuse=dither=sierra2_4a`.
- Más de 30 s de duración: línea de aviso con el tamaño estimado; no se bloquea.

### 4.5 Línea de consecuencia (bajo el selector)

Calculada con el plan de §5.1, una por caso, por prioridad: copia sin pérdida · recodifica (lento) · transparencia
→ blanco · solo primer fotograma · subtítulos descartados · HDR · no mejora la calidad.

---

## 5. Motor y pipeline

### 5.1 Plan (función pura, `cargo test`)

```
probe(file) → Source { class, container, streams[], alpha, frames, hdr, … }
outputs(Source, Encoders) → [Target]            // tabla §3 filtrada por §3.5
plan(Source, Target) → Plan { engine, args | image_ops, notes[], copy: bool }
```

`plan` no lanza procesos: es la tabla §3/§4 en código y se prueba entrada por entrada (MKV H.264+AAC → MP4 copia;
MKV H.264+FLAC → MP4 copia vídeo + AAC; PNG con alfa → JPG nota "white"…).

### 5.2 Ejecución

- **FFmpeg:** proceso aparte (como hoy), `-progress pipe:1 -nostats`; % = `out_time_us` / duración. Salida a
  `nombre.ext.part` y renombrado al terminar. Cancelar mata el proceso y borra el `.part`.
- **Imagen (Rust):** hilo del job; decodificar → ops (EXIF, ICC, fondo, cuantizar, ICO) → codificar a `.part`.
  AVIF de entrada se decodifica con FFmpeg a PNG temporal [I: el build incluye libdav1d] y sigue por Rust.
- **Jobs (`JOBS_SPEC`):** imagen y copia de flujos → carril ligero; recodificación de audio → CPU coste 1;
  recodificación de vídeo → CPU coste alto. Prioridad baja del proceso como el resto.
- Módulo nuevo `convert.rs` (secciones `probe`, `table`, `plan`, `ffmpeg`, `image`); página `convert.html/.css/.js`
  (secciones `state`, `drop`, `card`, `batch`, `job`).

### 5.3 Crates nuevos

| Crate | Para qué | Licencia |
|---|---|---|
| `image` 0.25 (ya en el árbol por Tauri, solo `png`) | Activar `jpeg`, `webp` (decodificar), `tiff`, `bmp`, `gif`, `ico`, `tga`, `qoi` | MIT OR Apache-2.0 [C] |
| `webp` | WebP con pérdida (enlaza libwebp, compilado con `cc`) | crate MIT OR Apache-2.0; libwebp BSD-3-Clause [I: confirmar con `cargo metadata`] |
| `kamadak-exif` (o el lector de orientación de `image` 0.25) | Orientación y quitar GPS | MIT OR Apache-2.0 [I] |

Por qué `webp` y no solo `image`: el encoder WebP de `image` solo hace **sin pérdida** ("Right now only lossless
encoding is supported") [C, docs.rs `image::codecs::webp::WebPEncoder`]. Alternativa sin C: codificar WebP con
FFmpeg (`libwebp`), a costa de que convertir PNG→WEBP exija FFmpeg (§13).

---

## 6. Lotes

- Soltar varios archivos o una carpeta: una lista compacta (nombre, tipo, estado) en lugar de la tarjeta única.
- Se agrupan por clase. Cada grupo tiene **un** selector "Convert to" con las salidas comunes al grupo (intersección);
  un solo **Convert all**.
- Cada archivo es un job; error en uno → rojo con motivo y el resto sigue. Cancelar para el en curso y vacía la cola.
- La isla de procesos muestra el lote como grupo: "Converter · 3/12 · clip-04.mov".
- Carpeta con subcarpetas: en `Exports\Converted\` se reproduce la estructura relativa; "Next to the original"
  deja cada salida junto a su original.

---

## 7. Modelo de datos

Sesión de la pestaña (`sessions.rs`):

```json
{
  "items": [
    { "path": "C:\\…\\clip.mkv", "class": "video", "summary": "H.264 + AAC · 1920×1080 · 3:12",
      "target": "mp4", "state": "done", "out": "C:\\…\\Exports\\Converted\\clip.mp4",
      "bytesIn": 812345678, "bytesOut": 809000000, "error": null }
  ],
  "groups": { "video": "mp4", "image": "webp" },
  "dest": "exports" | "beside" | "C:\\elegida"
}
```

Ajuste persistente: `converter.dest`. No hay más ajustes.

Nombres de salida: `{nombre}.{ext}`; si existe, `{nombre} (2).{ext}`. Si la salida coincidiría con el original
("Next to the original" y misma extensión, que §3 ya impide) nunca se escribe encima.

---

## 8. Integración

- **modules.js:** `{ id: "convert", icon: "repeat", src: "convert.html", group: 1, home: true,
  deps: [{ id: "ffmpeg", kind: "media" }], accepts: { image: "take", audio: "take", video: "take" },
  gives: ["image", "audio", "video"], stage: "beta" }`. Nombre visible "Converter". Imágenes funcionan sin FFmpeg.
- **Library:** cada salida entra con su `kind` y `origin` → el original y la herramienta "Converter" (vista de
  versiones). En la ficha: "Convert…" abre la pestaña con el archivo; con varios seleccionados, los manda como lote.
- **Send to:** recibe de cualquier herramienta que dé archivo; envía la salida a quien acepte su clase.
- **Arrastrar desde el Explorador** sobre el icono del dock de Converter: abre la pestaña con el archivo.
- **paths.rs:** carpeta nueva `Exports\Converted`.
- **Textos** solo en `en.json`. Archivos nuevos en `archive/tauri/architecture.md (Tauri)`.

---

## 9. Licencias

### 9.1 FFmpeg

**Documentado [C]:**
- Halation descarga `ffmpeg-master-latest-win64-gpl.zip` de yt-dlp/FFmpeg-Builds (`tools.rs:26`, URL "latest"),
  a `Documents\Halation\Tools\ffmpeg`, o usa uno del PATH. No va en el instalador (`THIRD_PARTY.md`, "Tools
  downloaded at run time"; `tauri.conf.json` no lo incluye).
- El build "gpl" incluye todas las dependencias, también las que exigen GPL completa; el "lgpl" carece de las
  solo-GPL, "most prominently libx264 and libx265"; "nonfree" añade fdk-aac (README de BtbN/FFmpeg-Builds, del que
  deriva el de yt-dlp).
- Halation ya usa libx264 (`encoder.js:28,37`, `interp.js:275`, `upscale.js:635`), libvpx-vp9 y libopus. Converter
  no añade ninguna dependencia de licencia nueva respecto a lo que ya se descarga.
- FSF, GPL FAQ: programas que se comunican por mecanismos normales entre programas separados (pipes, línea de
  órdenes, sockets) son normalmente programas separados ("mere aggregation"); la GPL no se extiende al otro.
- FSF, GPL FAQ ("Is there some way that I can GPL the output people get from use of my program?"): la salida de un
  programa GPL no queda bajo la GPL salvo que contenga partes del propio programa. Un MP4 hecho con x264 no es GPL.
- GPL-3.0 §6: quien distribuye el binario (código objeto) debe acompañarlo del código fuente correspondiente o de
  una oferta escrita.

**Inferido [I]:**
- Halation lanza `ffmpeg.exe` como proceso con argumentos: es agregación, no obra combinada. LICENSE 1.1 (propietaria
  freeware) no entra en conflicto con la GPL de FFmpeg. Es el mismo esquema que ya usa hoy.
- Hoy el distribuidor de los binarios es yt-dlp/FFmpeg-Builds (que publica scripts y fuentes); Halation solo
  descarga desde allí. **Si Sylphera aloja una copia de FFmpeg en sus releases** (como el espejo de `stems-v1`
  para Vocal Remover, o el plan sha256 + espejo para todos los componentes), Sylphera pasa a distribuir un binario
  GPL-3.0 y debe publicar a su lado el código fuente correspondiente (tarball de FFmpeg + scripts del build con sus
  versiones). Recomendación: fijar versión (no "latest") y sha256, pero apuntar a la release fija de
  yt-dlp/FFmpeg-Builds en lugar de espejar; si se espeja, subir también el fuente.
- Pasar al build LGPL no compra nada: Halation no enlaza FFmpeg, así que la GPL no le afecta, y se perdería
  libx264 que ya usan Visualizer, Upscale e Interpolate. Se queda GPL.
- No usar el build "nonfree": fdk-aac no es redistribuible y el AAC nativo de FFmpeg basta a 256 kbps.

**Patentes de códecs:**
- [C, conocimiento general, no reconsultado en esta sesión] H.264 y AAC tienen pools de patentes activos (Via LA; HEVC además Access Advance y otros). Las patentes de MP3
  expiraron y Fraunhofer cerró su programa de licencias en 2017. LZW (GIF) expiró en 2003–2004. VP9, Opus, Vorbis,
  FLAC y AV1 los publican sus autores libres de regalías; existen reclamaciones de terceros (pools de Sisvel para
  VP9 y AV1).
- [I] Las regalías de los pools recaen en quien distribuye codificadores/decodificadores o aparatos. Halation no
  distribuye el codificador (lo descarga el usuario de un tercero) y no cobra; el riesgo para Sylphera es bajo y es
  el mismo que ya tiene hoy con H.264 en Visualizer. No se añade HEVC como salida en v1: es el pool más agresivo y
  Windows no lo reproduce sin la extensión de pago.
- No hay cifras de riesgo ni casos concretos contra apps freeware que usen FFmpeg externo en las fuentes revisadas;
  el razonamiento es solo por incentivos (los pools persiguen volumen de unidades y fabricantes, no utilidades
  gratuitas que lanzan un binario de terceros).

### 9.2 Crates de imagen

- [C] `image`: MIT OR Apache-2.0; ya está en `Cargo.lock` (0.25.10, por Tauri).
- [I, confirmar con `cargo metadata --filter-platform x86_64-pc-windows-msvc` como hace hoy THIRD_PARTY] Los
  decodificadores que arrastra (`zune-jpeg`, `image-webp`, `tiff`, `gif`, `qoi`, `moxcms`…) son MIT/Apache/Zlib/BSD;
  ninguno copyleft. `webp` (crate) MIT OR Apache-2.0 y libwebp BSD-3-Clause, que exige reproducir su aviso de
  copyright en la documentación del binario.
- No hay nada GPL/AGPL enlazado en Halation por Converter.

### 9.3 Motores de la v2

| Motor | Licencia [C] | Cómo se usaría | Implicación [I] |
|---|---|---|---|
| **Pandoc** | GPL-2.0-or-later | `pandoc.exe` descargado de jgm/pandoc, proceso aparte | Igual que FFmpeg: agregación. No espejar sin el fuente. Su salida PDF necesita un motor LaTeX (cientos de MB) → PDF por LibreOffice, no por Pandoc |
| **LibreOffice** | MPL-2.0 (partes LGPL-3.0) | `soffice --headless --convert-to`, instalación existente del usuario o descarga | MPL es copyleft por archivo y no toca a quien lo invoca. ~350 MB instalado y sin portable oficial; un perfil por instancia (`-env:UserInstallation`) para no chocar con el LibreOffice abierto del usuario |
| **ImageMagick** | ImageMagick License (tipo Apache-2.0) | No necesario si Rust cubre imagen | Útil solo para formatos raros (PSD, RAW, EPS) |
| **Ghostscript** | AGPL-3.0 o comercial (Artifex) | Lo usa ImageMagick para PDF/EPS/PS | AGPL obliga a ofrecer el fuente a quien lo usa por red **si se modifica**, y a distribuirlo con fuente. Halation no lo modifica ni lo sirve por red: usarlo descargado es posible, pero espejarlo o empaquetarlo arrastra las obligaciones. Recomendación: **PDF → imagen con PDFium** (BSD-3/Apache-2.0, el de Chrome) en vez de Ghostscript |

[C, conocimiento general] Artifex hace cumplir la AGPL de Ghostscript (Artifex v. Hancom, 2017, acuerdo en 2018). [I] De ahí la
preferencia por PDFium: evita el único componente con titular que litiga.

### 9.4 Cambios en THIRD_PARTY.md y LICENSE 1.1

**THIRD_PARTY.md (v1):**
- Fila de FFmpeg: "Used for" añade "Converter"; fijar la versión cuando se fije la URL.
- Tabla de crates: regenerar con `cargo metadata` (entran los codecs de `image`, `webp`, `libwebp-sys`).
- Añadir el texto BSD-3-Clause de libwebp (Copyright Google Inc.) al final, como el ISC de Lucide.

**LICENSE 1.1 (v1):**
- [I] No hace falta cambiar nada sustancial: la salida de FFmpeg no está restringida por la GPL (§9.1), así que la
  frase "This License makes no promise about outputs made with third-party … tools" no cambia el resultado. Por
  coherencia, añadir "format conversion" a la lista de ejemplos de herramientas de terceros.
- La cláusula de DRM ya existente (commit 71262e3, "not designed for DRM") cubre Converter: FFmpeg no descifra DRM
  y no se intentará.

**v2:** filas de Pandoc (GPL-2.0+), LibreOffice (MPL-2.0) y PDFium (BSD-3) en "Tools downloaded at run time".

---

## 10. Rendimiento esperado

| Caso | Tiempo [I] |
|---|---|
| Copia de flujos (MKV → MP4, 2 GB) | Lo que tarde el disco (segundos) |
| Audio 3 min → MP3 | ~1–2 s |
| Vídeo 1080p 3 min → H.264 medium | ~1–2× tiempo real en 4 núcleos; más rápido en los PCs de Java |
| PNG 24 MP → JPG / WEBP | < 1 s / ~1–2 s |

Criterio: medir en el PC de pruebas y apuntarlo en `research/performance`.

---

## 11. Criterios de aceptación (v1)

1. Cada fila de §3 tiene un test de `plan` (`cargo test`): entrada sintética → argumentos/ops esperados y nota.
2. MKV (H.264 + AAC) → MP4 copia flujos: tiempo < 5 % del de recodificar y hash de los paquetes de vídeo idéntico.
3. MKV (H.264 + FLAC + PGS) → MP4: vídeo copiado, audio a AAC, subtítulos descartados con aviso.
4. Un `.mp3` que es WAV se detecta como WAV y lo dice.
5. PNG con alfa → JPG: fondo blanco; → WEBP: conserva alfa; JPG con orientación EXIF 6 → PNG sale derecho.
6. Sin FFmpeg: imágenes convierten; audio/vídeo muestran "Needs FFmpeg · Install" y funcionan tras instalar sin
   reiniciar.
7. Un FFmpeg sin libvorbis (simulado en `host.js`) oculta OGG y nada más.
8. Lote de 12 con un archivo roto: 11 hechos, el roto en rojo con motivo; cancelar a mitad no deja `.part`.
9. Nunca se escribe sobre el original (test con "Next to the original" y nombres que chocan).
10. Interfaz sin tareas > 50 ms durante la conversión; progreso real, reducir animaciones → fade.
11. THIRD_PARTY.md con las filas y avisos de §9.4.

---

## 12. Fuera de alcance

- **v2:** documentos (LibreOffice: DOCX/ODT/RTF/XLSX/PPTX → PDF y entre sí; Pandoc: MD/HTML/EPUB/LaTeX/Org/DocBook
  → HTML/EPUB/DOCX/ODT/MD), PDF → imágenes con PDFium.
- Más adelante: salida AVIF/HEIC, mapeo de tonos HDR → SDR, codificadores por hardware, recorte/redimensionado
  (para eso están Crop y Upscale), cambiar bitrate/calidad, unir o partir archivos, subtítulos sueltos (SRT↔VTT),
  archivos comprimidos (ZIP/7z), fuentes, 3D.
- Nada en la nube.

---

## 13. Preguntas abiertas

1. **WebP con pérdida:** `webp` crate (libwebp compilado en Halation; imágenes sin FFmpeg) — recomendado — o
   FFmpeg (sin C nuevo, pero PNG→WEBP exige FFmpeg).
2. **HEIC/HEIF de entrada** (fotos de iPhone): FFmpeg 7.1+ lee HEIF [I: no verificado con imágenes en mosaico]; WIC
   de Windows solo si el usuario tiene la extensión HEIF. ¿Entra en v1 si funciona con FFmpeg, o se deja?
3. **Metadatos:** ¿conservar EXIF (quitando GPS) o quitarlo todo por defecto?
4. **Carpeta por defecto:** `Exports\Converted` (recomendado, como el resto de herramientas) o junto al original.
5. **Nombre e icono:** "Converter" con icono `repeat` (Lucide) o `arrow-left-right`.
6. **FFmpeg fijado:** al fijar versión y sha256, ¿apuntar a la release fija de yt-dlp/FFmpeg-Builds (recomendado,
   sin obligaciones GPL de distribución) o espejar en Sylphera/Halation con el fuente al lado?

### Decisiones tomadas en la implementación (2026-10-07)

1. WebP con pérdida: crate `webp` (libwebp en Halation); PNG/JPG→WEBP no necesita FFmpeg.
2. HEIC/HEIF fuera de v1: se detecta y se marca como no soportado. AVIF de entrada pasa por FFmpeg.
3. Metadatos: EXIF fuera (la orientación se aplica a los píxeles). ICC se conserva en PNG, JPG, TIFF y WebP sin
   pérdida; se descarta en WebP con pérdida, BMP, GIF e ICO, sin convertir a sRGB.
4. Carpeta por defecto `Exports\Converted` (con la estructura de la carpeta en lotes); "Next to the original" y
   carpeta elegida como opciones, recordadas en el estado `converter`. Un archivo soltado sin ruta va a
   `Exports\Converted`.
5. "Converter" con icono `repeat`.
6. FFmpeg sigue con la URL actual (sin fijar versión ni sha256 en esta tarea).
- WebP animado de entrada: solo a GIF y PNG (primer fotograma). TIFF con LZW. Vídeo→GIF en una pasada
  (`split` + `palettegen` + `paletteuse`).
- El plan (argumentos de FFmpeg) se calcula en Rust (`convert.rs`, con tests que ejecutan FFmpeg real); la página lo
  ejecuta como trabajo (`ctx.proc`) para cancelar, prioridades y progreso.

### v2 implementada (2026-10-07)

- Clases nuevas: `document` (DOCX, DOC, ODT, RTF), `sheet` (XLSX, XLS, ODS, CSV), `slides` (PPTX, PPT, ODP),
  `markup` (Markdown, HTML, EPUB, LaTeX, Org, DocBook) y `pdf`. Detección por contenido: `%PDF`, partes del zip
  (`word/`, `xl/`, `ppt/`, el `mimetype` de OpenDocument y EPUB), OLE + extensión para los formatos viejos, `{\rtf`;
  los formatos de texto por extensión.
- Salidas: documento → PDF, DOCX, ODT, RTF, Markdown, HTML, EPUB; hoja → PDF, XLSX, ODS, CSV (solo la primera hoja);
  presentación → PDF, PPTX, ODP; markup → HTML, DOCX, ODT, EPUB, Markdown, PDF; PDF → PNG o JPG por página (200 dpi,
  máximo 8000 px; varias páginas → carpeta `nombre\nombre-001.png`).
- Motores: LibreOffice para formatos de oficina (perfil propio en la carpeta del trabajo; `soffice.com` en Windows);
  Pandoc para markup y para DOCX/ODT/RTF → Markdown/HTML/EPUB (HTML con recursos incrustados; Markdown en GFM, sin
  imágenes); markup → PDF pasa por DOCX y LibreOffice; DOC → Markdown/HTML/EPUB pasa por DOCX. PDFium por
  `pdfium-render`, cargado una vez por ejecución.
- Componentes descargables (Settings → Modules): Pandoc (última release de jgm/pandoc), LibreOffice (MSI oficial de
  la versión estable más nueva disponible en los espejos, desempaquetado con `msiexec /a` sin instalar ni pedir
  administrador; si el usuario ya tiene LibreOffice instalado se usa ese), PDFium (bblanchon/pdfium-binaries,
  chromium/7881, la versión de las bindings).
- Sin probar en Windows: el `msiexec /a` de LibreOffice y `soffice.com`; en el contenedor se probaron Pandoc 3.1,
  LibreOffice 24.2 y PDFium 7881 de Linux con tests reales (`cargo test`).

---

## Fuentes

- BtbN/FFmpeg-Builds, README (variantes gpl/lgpl/nonfree): https://github.com/BtbN/FFmpeg-Builds
- yt-dlp/FFmpeg-Builds: https://github.com/yt-dlp/FFmpeg-Builds
- docs.rs `image::codecs::webp::WebPEncoder`: https://docs.rs/image/latest/image/codecs/webp/struct.WebPEncoder.html
- FSF GPL FAQ (MereAggregation, GPLOutput): https://www.gnu.org/licenses/gpl-faq.html
- GPL-3.0 §6: https://www.gnu.org/licenses/gpl-3.0.html
- Código: `app/src-tauri/src/tools.rs:26,106,132`; `app/dist/encoder.js:20-37`; `app/dist/interp.js:274-341`;
  `app/dist/upscale.js:635`; `THIRD_PARTY.md`; `LICENSE` §2 y §6.
- Licencias de Pandoc, LibreOffice, ImageMagick, Ghostscript, PDFium y el caso Artifex v. Hancom: conocimiento
  general, no reconsultado en esta sesión; verificar en sus páginas oficiales antes de la v2.
