# Vocal Remover — Especificación (propuesta, revisión 2)

Save/export destinations now follow [the global save & export policy](SAVE_LOCATION_SPEC.md). This supersedes the tool-specific destination preferences and first-export folder prompt described below; processing and format behavior is unchanged.

Herramienta para separar canciones en pistas. **v1:** voz / instrumental con UVR-MDX-NET Inst HQ4, en GPU
(DirectML) o CPU, con lotes. **v2:** 4 stems (batería, bajo, otros, voz). Todo local con onnxruntime nativo.
Base: `vocal-remover/hq4/INFORME.md`, `vocal-remover/htdemucs/INFORME.md` y las medidas de §9 (2026-10-07).
Propuesta sin código. **[C]** comprobado o medido · **[I]** inferido.

Cambios de la revisión 2 (respuestas de Java, 2026-10-07): motor nativo con DLL aceptado; GPU para quien la tenga;
sin opción de calidad "High"; lotes en la v1; búsqueda de un modelo de 4 stems sin restricción comercial (§9).

---

## 0. Principios

1. **Local.** Sin servicios externos. GPU si la hay (DirectML), CPU si no o si la GPU falla, sin que el usuario
   tenga que elegir.
2. **Un job por canción, cancelable.** Cada canción es un job (`JOBS_SPEC`), con progreso por trozo y cancelación
   entre trozos. Un lote es una cola de esos jobs.
3. **Resultado progresivo.** Las pistas se dibujan trozo a trozo mientras se calculan; no hay pantalla de carga.
4. **Modelos verificados.** Cada archivo descargado se comprueba con sha256 y tiene un espejo.
5. **Licencia a la vista.** El crédito o aviso de cada modelo está junto a su modo.

---

## 1. Distribución de la pestaña

```
┌────────────────┬───────────────────────────────────────────────┬──────────────────┐
│ COLA           │  canción.mp3 · 3:12 · 44,1 kHz                │ EXPORTAR         │
│ ✓ tema-1.mp3   │  ▶ ──────●───────────────────────── 1:04      │ Formato  [WAV ▾] │
│ ● tema-2.mp3   │                                               │ Pistas  ☑ Voz    │
│   62 %         │  Voz          M S  ▁▃▅▇▅▃▁▁▃▅▇▅▃▁ (onda)       │         ☑ Instr. │
│ ○ tema-3.flac  │  Instrumental M S  ▅▇▇▅▃▅▇▇▅▃▅▇▇▅              │ ☑ Exportar al    │
│ ○ tema-4.wav   │                                               │   terminar       │
│ [+ Añadir]     │  ░░░░░░ esqueleto donde aún no hay resultado  │ [ Exportar ]     │
│                │                                               │ Send to… ▾       │
│ crédito modelo │  trozo 14/33 · GPU · quedan ~12 s             │                  │
│ [Separar todo] │                                               │                  │
└────────────────┴───────────────────────────────────────────────┴──────────────────┘
```

- Sin archivo: zona de soltar (archivos, carpeta, Library, Send to…). Acepta audio (mp3, wav, flac, m4a, ogg, opus)
  y vídeo (se extrae el audio). Soltar varios archivos o una carpeta los añade a la cola.
- **Cola** (izquierda): una fila por canción con estado (en espera, en curso con %, hecha, error, cancelada).
  Clic en una fila hecha la abre en el centro; se puede reordenar arrastrando las que esperan y quitar con ✕.
- **Centro:** la canción seleccionada. Reproductor común con **M**ute / **S**olo por pista (Web Audio,
  sincronizadas). Durante la separación cada carril es un esqueleto que se rellena con la onda real a medida que
  llega cada trozo (`motion.js`; el relleno avanza con `transform`, no con `width`; fade `--fade`).
- La línea de estado dice el dispositivo en uso ("GPU" / "CPU").
- Botón Separar todo → Cancelar (cancela la canción en curso y vacía la cola; las hechas se quedan).
- **Exportar al terminar** (marcado por defecto en lotes): cada canción se exporta sola en cuanto acaba, con el
  formato y las pistas elegidos, para que un lote largo no dependa de volver a la pestaña.

---

## 2. Modos

| Modo | Versión | Modelo | Pistas | Archivo |
|---|---|---|---|---|
| Vocals / Instrumental | **v1** | UVR-MDX-NET Inst HQ4 | Voz, Instrumental | 59 MB |
| 4 stems | v2 | HTDemucs (recomendado, §9) | Batería, Bajo, Otros, Voz | 170 MB (fp32) / 86 MB (fp16, GPU) |

- Sin opción de calidad: un solo ajuste por modelo, el de sus autores (HQ4: trozos de 261 120 muestras con paso
  256 000; HTDemucs: shifts 0, solape 0,25).
- En la v1 solo existe el primer modo y la interfaz no muestra selector de modo. La v2 añade el selector y el
  componente `stems-htdemucs`.
- Las tarjetas dicen para qué es cada uno: "Vocals · Instrumental · Fast" y "4 stems · Best vocal separation ·
  slower". HTDemucs deja la voz limpia, sin el sangrado del instrumental que deja HQ4, a cambio de tiempo; por eso no
  hay un interruptor Clean (descartado por Java, 2026-10-07).

---

## 3. Componentes, descarga y verificación

### 3.1 Componentes

| id | Contenido | Tamaño | Origen principal | Espejo |
|---|---|---|---|---|
| `onnxruntime` | `onnxruntime.dll` con DirectML + `DirectML.dll` | 17,3 + 18,5 MB [C] | NuGet `Microsoft.ML.OnnxRuntime.DirectML` 1.24.4 y `Microsoft.AI.DirectML` 1.15.4 (se extraen las dos DLL win-x64) | release `stems-v1` de Sylphera/Halation |
| `stems-hq4` | `UVR-MDX-NET-Inst_HQ_4.onnx` | 59 074 342 B | release `all_public_uvr_models` de TRvlvr/model_repo | release `stems-v1` |
| `stems-htdemucs` (v2) | `htdemucs-955717e8-dml4.onnx` + `DEMUCS-LICENSE.txt` | 170,4 MB | release `stems-v4` (export propio con los arreglos de DirectML; `stems-v3` y `stems-v2` los anteriores) | segundo host [abierta] |

- Carpeta `Documents\Halation\Tools\stems\` (como `Tools\cutout\`).
- Descargar de NuGet obliga a abrir el `.nupkg` (zip) y sacar dos archivos de 12 y 202 MB de paquete. Propuesta:
  el principal es el espejo propio (las dos DLL sueltas, 36 MB) y NuGet queda de respaldo.
- Licencias [C]: onnxruntime es MIT. DirectML tiene licencia propia de Microsoft que permite "copy and distribute
  the software … in applications … that run on Windows". Incluye una cláusula de datos: DirectML "may collect
  information about you and your use of the software, and send that to Microsoft". PRIVACY.md debe mencionarlo y
  THIRD_PARTY citar la licencia.
- El ONNX de HTDemucs no existe oficialmente: se exporta desde el `.th` de Meta con `app/scripts/htdemucs-export.py`
  (sale de `vocal-remover/htdemucs/export.py`) y se publica como SAM 2.1 (`cutout-sam21-v1`).

### 3.2 Verificación (nuevo, común a todos los modelos)

Hoy `workspace.rs` solo guarda un FNV-1a 64 para reutilizar archivos y varias URL son "latest" sin hash. Propuesta:

- Tabla fija en Rust por archivo: `{ file, size, sha256, urls: [principal, espejo] }`. Nada de "latest".
- Descarga a `.part` → tamaño y sha256 (crate `sha2`) → renombrar. Si no coincide: borrar y probar el espejo; si
  los dos fallan, error claro y nada queda instalado.
- `models.json` añade `sha256`; `model_reuse` compara con el sha256 esperado, no con el FNV.
- `find_*` da el componente por instalado si los archivos existen con el tamaño esperado; el sha256 completo se
  comprueba al instalar.
- Solo para Vocal Remover en esta tarea; migrar Cutout, Upscale, RIFE, yt-dlp y FFmpeg es tarea aparte.

---

## 4. Motor: onnxruntime nativo con DirectML

- Crate `ort` con `load-dynamic`: la app arranca sin la DLL y la carga desde `Tools\stems\` al separar. La versión
  del crate debe hablar la API de onnxruntime 1.24 (test que lo compruebe, como `runtime_url_matches_the_bundled_version`).
- **Por qué DirectML y no CUDA** [C]:
  - DirectML funciona con cualquier GPU DirectX 12: la Nvidia del portátil de Java y la RX 6650 XT del PC con el
    mismo archivo. CUDA solo sirve en Nvidia.
  - Tamaño: DirectML son 36 MB en total. CUDA son `onnxruntime_providers_cuda.dll` (187 MB) más el runtime de CUDA
    y cuDNN, que se descargan aparte y suman cientos de MB más [I en la cifra exacta].
  - La misma `onnxruntime.dll` de DirectML trae el proveedor de CPU, así que un solo componente sirve para todos.
- **Riesgo** [C]: Microsoft tiene DirectML "en mantenimiento" (solo arreglos de seguridad) y recomienda Windows ML
  para proyectos nuevos; el paquete de onnxruntime con DirectML se quedó en la 1.24.4 (marzo de 2026) mientras
  onnxruntime va por la 1.30. Para estos dos modelos (Conv, ConvTranspose, BatchNorm, MatMul, Softmax…) no hace
  falta nada nuevo [I]. Windows ML exige Windows 11 24H2 y el Windows App SDK; queda como sustituto si DirectML deja
  de funcionar. Las versiones quedan fijadas y la vuelta a CPU es automática.
- **Elección del dispositivo:** al cargar el modelo se intenta DirectML en la GPU de alto rendimiento (adaptador
  elegido por DXGI, preferencia "high performance", que en portátiles evita la integrada); si la sesión no se crea
  o el primer trozo falla, se repite en CPU y se avisa en una línea ("GPU no disponible, usando CPU"). Ajustes →
  Rendimiento añade "Vocal Remover: Auto / Solo CPU".
- **Memoria de vídeo:** un trozo de HQ4 son unos 10 MB de entrada y el modelo 59 MB; la VRAM no es un problema.
  HTDemucs fp16 (86 MB) en GPU y fp32 en CPU (fp16 en CPU es 44× más lento [C]).
- **Convivencia:** el job ocupa el carril GPU cuando corre en GPU (compite con Upscale, Interpolate y Cutout como
  dice `JOBS_SPEC`) y el carril CPU cuando cae a CPU. En CPU: `intra_op` = núcleos físicos − 1 y prioridad baja.

---

- **HTDemucs en DirectML (2026-10-07):** en la RX 6650 XT la sesión de DirectML no se creaba
  (`MLOperatorAuthorImpl.cpp(2818) … 80070057`, `stems.log`) y la canción iba entera a la CPU (~100 s para 4:32).
  `dml_probe` (stems.rs, ignorado: el modelo en cada nivel de optimización y una sonda por operador distinto, de
  `make_probes.py` en la carpeta del proyecto `vocal-remover/dml-probe`) señaló las 4 ConvTranspose 1-D del decoder
  temporal y los Reshape con `allowzero=1`. `app/scripts/htdemucs-dml.py` las pasa a ConvTranspose 2-D de altura 1 y
  `allowzero=0` (ninguna forma lleva un 0): mismos pesos, salidas idénticas bit a bit en CPU. Archivo nuevo
  `htdemucs-955717e8-dml4.onnx` en la release `stems-v4`; instalarlo borra los de `stems-v2` y `stems-v3`. stems-v4: DirectML
  fusionaba mal Split → Sigmoid → Mul (las GLU) y daba pistas miles de veces más altas; cada Split va como Slices (mismas
  salidas en CPU, bit a bit). `dml_check` y `dml_pieces` (stems.rs) lo comprueban en Windows.

## 5. Pipeline

Corre en Rust (nuevo módulo `stems.rs`), en un hilo del job; la página recibe progreso y la onda reducida de cada
trozo.

```
archivo ─FFmpeg→ PCM f32 estéreo 44,1 kHz ─trocear→ [STFT → ONNX → iSTFT] por trozo ─solapar y sumar→ pistas
```

1. **Decodificar** con FFmpeg a f32 estéreo 44 100 Hz. Mono → L/R iguales; más de 2 canales → mezcla estéreo.
2. **Trocear:** HQ4, 261 120 muestras con paso 256 000 y relleno de n_fft/2 en los extremos.
3. **STFT fuera del modelo** (crate `rustfft`, Hann periódica, center con reflect, rfft unilateral):
   - HQ4: n_fft 5120 (radix mixto 2¹⁰·5), hop 1024, dim_f 2560, dim_t 256; entrada `[1, 4, 2560, 256]`; los 3
     primeros bins a cero. Salida = instrumental; **voz = mezcla − instrumental × 1,019**.
   - HTDemucs (v2): n_fft 4096, hop 1024, `normalized`, relleno de 1536 muestras por lado, recorte de 2 frames,
     último bin descartado, real/imag como canales; salida = iSTFT(espectro de cada stem) + rama temporal.
4. **Solapar y sumar** con ventana Hann por trozo (HQ4) o la triangular de `apply_model` (HTDemucs), normalizando
   por la suma de ventanas.
5. **Memoria:** solo el trozo en curso vive como espectro; objetivo < 1 GB de pico por job (el 2,4 GB medido
   cargaba todo a la vez).
6. **Cancelar:** bandera comprobada entre trozos; borra los temporales del job.
7. **Fidelidad (cargo test):** STFT→iSTFT ida y vuelta < 1e-6; un trozo fijo de referencia (de los scripts de los
   informes) frente a Rust con error relativo < 1e-3; DirectML frente a CPU en el mismo trozo < 1e-3 (test real).

---

## 6. Lotes

- Una cola por pestaña; cada canción es un job independiente. Una canción a la vez: el modelo ya usa toda la GPU o
  todos los núcleos, así que dos a la vez no acaban antes [I].
- La sesión de onnxruntime se crea una vez y se reutiliza para toda la cola (cargar HQ4 cuesta 0,15–0,35 s en CPU [C];
  en GPU la primera carga es más lenta [I]).
- Un error en una canción (archivo roto, sin audio) la marca en rojo con el motivo y la cola sigue.
- La isla y la bandeja de procesos muestran el lote como un grupo: "Vocal Remover · 2/4 · tema-2.mp3".
- La cola se guarda en la sesión (archivos y estado); al reabrir, las pendientes siguen pendientes y no arrancan
  solas.

---

## 7. Rendimiento esperado

| Modo | Dispositivo | 3 min de audio | Ritmo |
|---|---|---|---|
| HQ4 | CPU 4 núcleos Xeon 2,1 GHz [C] | 72 s (modelo 65 s, STFT 6 s) | 0,40× tiempo real |
| HQ4 | GPU DirectML | sin medir; [I] el modelo pasa a pocos segundos y el STFT en CPU (~6 s) manda: ~10 s | |
| HTDemucs (v2) | CPU 4 núcleos [C] | 66 s | 0,37× tiempo real |

- Criterio de aceptación: medir HQ4 en el portátil con Nvidia y en el PC con RX 6650 XT, GPU y CPU, y apuntarlo en
  `docs/performance`. Si el STFT pesa demasiado frente a la GPU, se paraleliza por canal y por trozo.
- Lote de 10 canciones de 3 min: ~12 min en CPU de 4 núcleos [C por extrapolación]; ~2 min en GPU [I].
- "Quedan ~N s" sale del tiempo medio por trozo tras los dos primeros; en lote, también el total de la cola.

---

## 8. Salida e integración

- **Formatos:** WAV 24 bit (por defecto), FLAC 24 bit, MP3 320 kbps (FFmpeg). 44,1 kHz, u "Igual que el original"
  (remuestreo con FFmpeg al exportar).
- Sin normalizar; si una pista supera 0 dBFS se aplica la ganancia mínima para no recortar y se avisa en una línea.
- **Carpeta y nombres:** `Exports\Stems\{nombre}\{nombre} (vocals).wav`, `(instrumental)`; en v2 también
  `(drums)`, `(bass)`, `(other)`. Carpeta existente → sufijo ` (2)`.
- **Save to:** `Exports\Stems` o una carpeta elegida. La primera exportación (a mano o la automática) pregunta una vez si
  cambiarla ("Keep this folder" / "Choose a folder…"); lo elegido queda fijo y se cambia desde la línea Save to del
  panel Export. Cancel no exporta y vuelve a preguntar la próxima vez.
- Exportar solo las pistas marcadas; opción "Mezcla de lo activo" (las pistas no silenciadas sumadas).
- **modules.js:** `{ id: "stems", icon: "audio-lines", src: "stems.html", group: 1, home: true,
  deps: [{ id: "ffmpeg" }, { id: "onnxruntime" }, { id: "stems-hq4" }], accepts: { audio: "takeAudio",
  video: "takeVideo" }, gives: ["audio"], stage: "beta" }`. Nombre visible "Vocal Remover".
- **Archivos:** `stems.html/.css/.js` (secciones `state`, `queue`, `ui`, `player`, `job`, `export`), `stems.rs`;
  entradas en `docs/ARCHITECTURE.md`.
- **Library:** cada pista exportada entra como `kind: "audio"` con `origin` → la canción original y la herramienta
  "Vocal Remover"; se agrupan bajo la original (vista de versiones). En la ficha de un audio: "Separar pistas";
  con varios audios seleccionados, la misma acción los manda a la cola.
- **Send to:** recibe de Downloader (también un álbum entero, que entra como lote) y de Library; envía a Visualizer
  y a cualquier herramienta que acepte `audio`; "Back to <origen>" devuelve la pista elegida.
- **Sesiones:** archivos de la cola, estado y selección; los resultados no (se reabren desde Exports o la Library).
- **Textos** solo en `en.json`.

---

## 9. Licencias y modelo de 4 stems

### 9.1 v1 (HQ4)

- Código MDX-Net MIT; UVR pide "MIT y crédito" a apps de terceros; dataset no documentado; sin cláusula no
  comercial escrita [C, informe HQ4].
- En la app, bajo la cola: "Model UVR-MDX-NET Inst HQ4 by UVR (Anjok07, aufr33)." Sin aviso de uso no comercial.
- THIRD_PARTY y Acerca de: HQ4 (crédito UVR), onnxruntime (MIT), DirectML (licencia de Microsoft), rustfft
  (MIT/Apache-2.0).
- LICENSE 1.1: "stem separation" se añade a la lista de herramientas de terceros; no cambia la frase de Sharp.
- Aviso común en la zona de soltar, como en Downloader: "Use only audio you own or have permission to use."

### 9.2 Búsqueda de un modelo de 4 stems sin restricción comercial

Revisado el catálogo de UVR (`TRvlvr/application_data/filelists/download_checks.json`) y los datasets públicos [C]:

- **Todos los modelos propios de UVR son de 2 pistas** (voz/instrumental, karaoke, dereverb…). Su README lo dice:
  entrenaron todo "except for the Demucs v3 and v4 4-stem models". No hay batería ni bajo de UVR.
- Los modelos de 4 stems del catálogo de UVR son de terceros:
  - **kuielab_a / kuielab_b** (KUIELab, MDX Challenge 2021): 4 modelos MDX-Net, uno por stem, 29,7 MB cada uno.
    El README de kuielab/mdx-net dice que Leaderboard A se entrenó con MUSDB18 sin la parte de test y Leaderboard B
    con test incluido. **Datos: solo MUSDB18 → no comercial, más explícito que HTDemucs.**
  - **Demucs v3/v4** (Meta): MUSDB18-HQ + 800 canciones internas.
  - **DrumSep** (aufr33 y jarredou): separa una batería en piezas (bombo, caja…), no una mezcla en 4 stems.
- Los modelos de 4 stems de la comunidad (Music-Source-Separation-Training, Roformer) se entrenan con MUSDB18-HQ y/o
  MoisesDB. MoisesDB es CC BY-NC-SA 4.0, solo investigación no comercial.
- **[I] No existe un modelo público de 4 stems con datos de entrenamiento que permitan uso comercial**: los únicos
  datasets multipista con batería y bajo etiquetados son MUSDB18 y MoisesDB, y los dos son no comerciales.

Medida de kuielab_a frente a HTDemucs, mismas 50 pistas de test de MUSDB18-7-WAV, CPU 4 núcleos, onnxruntime 1.29
(kuielab_a con el pipeline de UVR; script `vocal-remover/kuielab/kl_eval.py`):

| | kuielab_a | HTDemucs | 
|---|---|---|
| Batería (museval, mediana) | 6,51 dB | 9,69 dB |
| Bajo | 7,25 dB | 9,46 dB |
| Otros | 4,90 dB | 5,38 dB |
| Voz | **10,21 dB** | 9,34 dB |
| Media 4 stems | 7,22 dB | **8,47 dB** |
| 3 min de audio (CPU) | 335 s (batería 56, bajo 125, otros 82, voz 72) | **66 s** |
| Tamaño | 4 × 29,7 MB = 119 MB | 170 MB |
| Datos de entrenamiento | MUSDB18 (no comercial) | MUSDB18-HQ + 800 internas |

- SDR medido en las **36 primeras pistas** de las 50 (el proceso se cortó por límite de tiempo a las 36); HTDemucs se
  compara en esas mismas 36 (sus cifras de las 50 están en el informe de HTDemucs). Datos: `vocal-remover/kuielab/`.
- kuielab_a solo gana en voz (+0,9 dB) y pierde 2–3 dB en batería y bajo; es 5× más lento porque son cuatro modelos
  y el de bajo usa n_fft 16384.

**Decisión v2 (Java, 2026-10-07):** HTDemucs, con un aviso técnico suave bajo el modo: "Model HTDemucs by Meta
(MIT). Its training data (MUSDB18-HQ) is licensed for non-commercial use; check it before using results
commercially." HTDemucs separa mejor (+1,25 dB de media, +2–3 dB en batería y bajo) y es 5× más rápido; cambiar de
modelo no quitaría el aviso. LICENSE 1.1 lo nombra en la frase de modelos de terceros con el mismo tono, sin la
prohibición tajante de Sharp.

---

## 10. Criterios de aceptación (v1)

1. Una canción de 3 min da voz e instrumental; voz + instrumental × 1,019 reconstruye la mezcla (error < −60 dB).
2. Salida Rust frente a la referencia Python: error relativo < 1e-3 por trozo, en CPU y en DirectML.
3. Sin GPU DirectX 12 (o con "Solo CPU"), separa en CPU sin errores; con GPU, la línea de estado dice "GPU".
4. Descarga: sha256 erróneo en el principal → espejo; en los dos → error y nada instalado (`host.js` y `cargo test`).
5. Lote de 4 canciones con una rota: 3 hechas y exportadas solas, la rota en rojo con motivo; cancelar a mitad
   libera la GPU/CPU en < 1 s y no deja archivos.
6. La interfaz no tiene tareas > 50 ms durante la separación (`tests/motion.js` trace); las ondas llegan trozo a
   trozo.
7. Mute/Solo y la mezcla de lo activo suenan sincronizados; exportar da exactamente lo escuchado.
8. Las pistas aparecen en la Library enlazadas a su original; "Separar pistas" con varios audios llena la cola.
9. Tiempos medidos en los dos PCs (GPU y CPU) apuntados en `docs/performance`.
10. Reducir animaciones: todo pasa a fade.

---

## 11. Fuera de alcance

- **v2:** 4 stems con HTDemucs (selector de modo, `stems-htdemucs`, fp16 en GPU, aviso técnico de datos de entrenamiento).
- Más adelante: `htdemucs_ft` (4× tiempo), `htdemucs_6s`, karaoke (voz principal frente a coros), dereverb,
  Windows ML como sustituto de DirectML, sha256 y espejo para el resto de componentes.
- Vídeo de salida con el audio cambiado; separación en tiempo real.

---

## 12. Decisiones (Java, 2026-10-07)

1. **Espejo:** HQ4, las dos DLL y el ONNX de HTDemucs se alojan en releases de Sylphera/Halation (`stems-v1`,
   `stems-v2`); las DLL toman ese espejo como origen principal y NuGet como respaldo; HQ4 sigue tirando primero de UVR.
2. **v2:** HTDemucs con el aviso técnico suave de §9.2.
3. **Nombre:** "Vocal Remover" en v1 y v2.
