# Jobs y workspace — Especificación v1

Status: Partial — the native backend has the queue, processes and native-task engine ([backend import](../SLINT_BACKEND_IMPORT.md)); Converter submits real media and component jobs (2026-10-22). Jobs still has no page; Activity stays the small top button. Not checked against this spec point by point.

Un único sistema de jobs para todo el trabajo pesado de Halation (colas, prioridades, recursos, cancelación) y un
workspace temporal compartido para caché, archivos intermedios y modelos. Objetivo: que varias herramientas no
compitan a la vez por CPU, GPU, RAM y disco, sin duplicar datos y limpiando solo lo que ya no hace falta. Idea de
Java: 2026-09-30. Encaja con el PR #1 (reposo a los 30 s, descarga a los 5 min, cierre seguro, sesiones).

---

## 0. Principios

1. **Un solo planificador.** Todo trabajo de más de ~1 s o que lanza un proceso pasa por `__hal.jobs`. Ninguna
   herramienta arranca procesos ni exportaciones por su cuenta.
2. **Colas por recurso, no un job a la vez.** Cada recurso (GPU, CPU, red, ligero) es un carril con su propia
   capacidad y su propia cola. Lo pesado se limita, lo ligero pasa sin esperar, y trabajos de carriles distintos
   corren a la vez.
3. **Coste, no solo número.** Cada job dice cuánto pesa en su carril (y RAM, VRAM y disco estimados); el
   planificador llena cada carril hasta su capacidad, no hasta un número fijo de jobs.
4. **Lo que ve el usuario va primero.** La vista previa y la interacción no son jobs y nunca esperan; el trabajo de
   fondo cede ante el que el usuario ha pedido.
5. **Cancelar es inmediato y limpio.** Cancelar mata los procesos, aborta las exportaciones y borra los intermedios.
6. **Un workspace, una copia.** Un único sitio para temporales y cachés, con claves por contenido, un presupuesto y
   limpieza automática.

---

## 1. Qué hay hoy

- `shell.js` → `runTool` / `procs.rs` → `proc_start` (con `low`: prioridad por debajo de normal) y `proc_kill`. Cada
  herramienta lanza lo suyo cuando quiere.
- Colas propias: Visualizer (`runQueue`), Upscale (`runQueue`, también los cutouts por lotes), Downloader (`pump`),
  Grade (`runBatch`), AI Interpolate (`run`), instalaciones de componentes
  (`installTool`). Frame Capture tiene trabajo de fondo que espera a `quiet`.
- Uso de GPU sin coordinar: upscayl-bin y RIFE (Vulkan), Cutout (WebGPU), WebCodecs con aceleración. Upscale e
  Interpolate a la vez se reparten la VRAM.
- Temporales y cachés repartidos: `Tools\temp` (y `Tools\temp\interp-<n>`), `Tools\cache\cutout`,
  `Tools\cache\library`, `%LOCALAPPDATA%\Halation\cache\framegrab`, `Settings\Recent`. Solo Frame Capture tiene
  límite (Settings → Storage). Varios viven en Documentos, que OneDrive puede sincronizar.
- PR #1: `busy()` / `idle()` por herramienta deciden reposo, descarga y el aviso al cerrar (`working`).

---

## 2. Arquitectura

```
 herramienta (iframe) ──submit──▶  jobs.js (ventana principal: planificador, cola, recursos)
        ▲   ctx.progress / ctx.proc         │ start / cancel             │ eventos "jobs"
        └────────────────────────────────── │ ──────────────┐            ▼
                                            ▼               │     bandeja de procesos (PROCESS_MENU_SPEC)
                              procs.rs (procesos, árbol,    │     barra de tareas, notificaciones, Library
                               prioridad, kill)             │
                              workspace.rs (leases, caché,  │
                               presupuesto, limpieza,       ◀┘
                               recursos del sistema)
```

- **`jobs.js`** (ventana principal, nuevo archivo compartido con secciones `model`, `resources`, `scheduler`,
  `runners`, `api`): la cola, el estado de cada job y la decisión de arrancar. Vive en la ventana principal porque
  es la única que habla con Tauri y no se descarga nunca.
- **`workspace.rs`** (nuevo módulo Rust): carpetas de trabajo por job, caché común, presupuesto, limpieza y lectura
  de recursos del sistema (RAM libre, disco libre, GPU presente).
- **`procs.rs`:** sigue lanzando procesos; añade el id de job a cada proceso para matar todos los de un job, y el
  árbol completo (un Job Object de Windows por job).
- El código de cada herramienta queda como el "runner" de su job (la función `run`), que se ejecuta en su página.

---

## 3. Modelo de datos

```json
{
  "id": "j_000123",
  "tool": "upscale",
  "kind": "upscale",
  "title": "cover.jpg",
  "detail": "4× · realesrgan-x4plus",
  "thumb": "blob:…",
  "priority": "normal",
  "lane": "gpu", "cost": 1, "needs": { "vramMB": 1800, "ramMB": 1500, "diskMB": 400 }, "then": "cpu",
  "host": "process",
  "state": "running",
  "progress": 0.42,
  "stage": "Upscaling",
  "eta": 38,
  "createdAt": 1790000000000, "startedAt": 1790000004000, "endedAt": null,
  "cancellable": true,
  "waitingFor": null,
  "outputs": [],
  "origin": { "from": ["i_8f3a…"] },
  "error": null,
  "group": "upscale-batch-7"
}
```

- **`priority`:** `user` (lo pidió el usuario y lo está esperando delante: el cutout de la imagen abierta, abrir un
  vídeo en Frame Capture), `normal` (exports, descargas, lotes), `background` (análisis de Frame Capture,
  miniaturas, índice de la Library, precálculos).
- **`lane`:** el carril que ocupa (§4): `gpu`, `cpu`, `net` o `light`. Un job que cambia de recurso por etapas
  (AI Interpolate: extraer en CPU, interpolar en GPU, montar en CPU) es un grupo de jobs encadenados, o declara
  `then` y el planificador lo mueve de carril entre etapas con `ctx.switch(lane)`.
- **`cost`:** cuánto ocupa de la capacidad de su carril (defecto 1; §4.2 dice cómo se estima).
- **`needs`:** estimaciones de VRAM, RAM y disco. Una estimación desconocida es 0 (no bloquea); la real se mide al
  correr y corrige las siguientes del mismo `kind` (§4.3).
- **`host`:** `process` (el trabajo lo hace un proceso externo), `page` (WebCodecs, WebGL, worker de ONNX dentro de
  una página).
- **`state`:** `queued` → `running` → `done` | `failed` | `cancelled`; `held` (en cola, retenido a mano);
  `waiting` (en cola, listo pero sin recursos: `waitingFor` dice cuál: `gpu`, `vram`, `cpu`, `ram`, `disk`, `net`).
- **`group`:** agrupa los jobs de un lote (Upscale de 20 imágenes, cola del Visualizer) para mostrarlos juntos y
  cancelarlos juntos.
- **`outputs`:** archivos escritos; al terminar se entregan a la Library con `origin` (LIBRARY_SPEC §7).
- Los jobs terminados se guardan en memoria (los últimos 50) para la bandeja; no se persisten entre sesiones.

### 3.1 API (`window.__hal.jobs`)

```js
const job = HAL.jobs.submit({
  tool: "upscale", kind: "upscale", title, detail, thumb, group,
  priority: "normal", lane: "gpu", cost: 1, needs: { vramMB: 1800, ramMB: 1500, diskMB: 400 }, host: "process",
  run: async ctx => {
    const dir = await ctx.workdir();                  // lease en el workspace (§6), borrada al terminar
    const p = await ctx.proc("upscaler", args, line => ctx.progress(parse(line), "Upscaling"));
    if (await p.done) throw new Error(t("up.err.failed"));
    ctx.output(outPath, { kind: "image" });
  },
  onCancel: () => {}                                  // opcional: lo que no sea un proceso o un encoder
});
await job.done;                                       // resultado, o error con name "AbortError" si se canceló
```

- `ctx`: `id`, `signal` (AbortSignal), `progress(v | null, stage?)`, `eta(s)`, `proc(tool, args, onLine)` (el
  proceso queda ligado al job), `encoder(format, o)` (`encoder.js` ligado al job), `workdir()`, `cache` (§6.2),
  `output(path, meta)`, `switch(lane)` (pasa a otro carril entre etapas; espera sitio allí), `yield()` (un job
  `background` largo lo llama entre pasos: si hay trabajo de más prioridad en su carril, espera ahí).
- `submit` responde al momento (no espera a que el job arranque) y el job trabaja sobre una instantánea de lo que
  recibe: la herramienta sigue libre para editar y lanzar más (PROCESS_MENU_SPEC §2.1).
- Resto: `list()`, `get(id)`, `cancel(id | group)`, `hold(id, on)`, `move(id, index)` (reordenar la cola dentro de
  su prioridad), `clearFinished()`, `busy(tool?)`, `idle()`, evento `jobs` (`{ changed, counts }`).
- Las llamadas cortas (una lectura de `ffprobe`, `yt-dlp -J`, una miniatura) son jobs del carril `light`: pasan
  sin cola, pero quedan ligadas a su herramienta y se cancelan con ella. `runTool` queda como implementación interna
  de `ctx.proc`.

---

## 4. Planificación

### 4.1 Carriles

Cada recurso es un carril con capacidad propia y su cola. Un job ocupa `cost` unidades de su carril mientras corre;
arranca cuando su carril tiene sitio y RAM, VRAM y disco lo permiten. Los carriles son independientes: un upscale en
GPU, dos exports en CPU, tres descargas y cualquier número de lecturas ligeras corren a la vez.

| Carril  | Qué va ahí                                                            | Capacidad (Balanced)     |
|---------|-----------------------------------------------------------------------|--------------------------|
| `gpu`   | upscayl-bin, RIFE, Cutout en WebGPU   | 2 unidades, y la VRAM    |
| `cpu`   | FFmpeg (codificar, extraer, montar), WebCodecs por software, lotes de Grade, análisis de Frame Capture | 2 unidades |
| `net`   | descargas de yt-dlp y de componentes                                  | 3 unidades               |
| `light` | `ffprobe`, `yt-dlp -J`, miniaturas, leer metadatos, escribir el índice | sin límite práctico (16 a la vez como tope de seguridad) |

- **Ligero:** un job de menos de ~1 s o que no usa CPU sostenida. No espera a nadie. Si un job `light` pasa de 5 s,
  el planificador lo trata desde entonces como `cpu` de coste 1 para los que llegan después (no lo detiene) y anota el
  `kind` como pesado para la próxima vez.
- **Sin GPU** o con "Use the GPU" apagado, los jobs `gpu` corren en su versión CPU (RIFE `-g -1`, Cutout WASM,
  encoder por software) y entran en el carril `cpu`.

### 4.2 Coste

- Por defecto 1. Un job declara más cuando satura más su recurso: RIFE en 4K o Upscale ×4 de una imagen de más de
  12 MP cuestan 2 en `gpu` (ocupan el carril entero); un Cutout cuesta 0,5 (caben cuatro).
- En `gpu` manda además la VRAM: un job entra solo si la suma de `vramMB` de los que corren más la suya cabe en el
  80 % de la VRAM dedicada (leída de DXGI en `workspace.rs` → `sys_resources`). Con poca VRAM, dos jobs de coste 1 no
  entran juntos aunque haya unidades.
- En `cpu`, cada job de FFmpeg recibe `-threads` = núcleos ÷ capacidad del carril, para que dos a la vez no se
  pisen.

### 4.3 Aprende de lo que mide

- Al terminar, cada job guarda su pico real de RAM y VRAM (del proceso, por `procs.rs`) y su duración, por `kind` y
  tamaño de entrada, en `workspace\stats.json`. Las estimaciones siguientes del mismo `kind` usan esas medidas.
- Si durante la marcha la RAM libre baja de la reserva, el carril deja de admitir jobs nuevos hasta que se recupere
  (no mata ninguno). Si la VRAM libre baja del 10 %, igual en `gpu`.
- Si dos jobs de GPU a la vez tardan más juntos que uno tras otro (medido en `stats.json` por `kind`), la próxima vez
  ese par no se junta: el coste de ese `kind` sube a 2.

### 4.4 Orden y prioridad

- En cada carril: prioridad (`user` > `normal` > `background`) y, dentro de ella, el orden de la cola (FIFO,
  reordenable a mano).
- **Relleno:** si el primero de la cola no cabe (coste o VRAM), puede arrancar otro de detrás que sí quepa, salvo que
  el primero lleve esperando más de 30 s: entonces se le guarda el sitio y nadie le adelanta.
- **Ceder:** mientras haya un job `user` o `normal` en un carril, los `background` de ese carril no arrancan y los que
  corren esperan en su próximo `yield()`. Los procesos de fondo siguen con prioridad por debajo de normal (lo que hoy
  hace `low`).
- **Sin expulsión:** un job en marcha no se detiene por otro que llega (salvo cancelar). Un job `user` pasa delante
  de toda la cola de su carril y puede usar una unidad de reserva: cada carril pesado admite `capacidad + 1` si el
  que entra es `user` (el cutout de la imagen abierta no espera a un lote de upscale).
- **Grupos por etapas:** en AI Interpolate, la extracción (`cpu`), la interpolación (`gpu`) y el montaje (`cpu`)
  pasan de carril en carril; mientras un vídeo interpola en GPU, el siguiente ya puede extraer en CPU.

### 4.5 Otros

- **Red:** no compite con CPU / GPU; el posproceso con FFmpeg de una descarga es otro job del grupo en `cpu`.
- **Minimizada:** `continue` (defecto) sigue igual; `pause queued` no arranca jobs nuevos hasta volver.
- **Fallo:** un job que falla no bloquea la cola; el resto sigue. Reintentar (bandeja) crea un job nuevo con los
  mismos datos. Un job de GPU que falla por falta de memoria de vídeo se reintenta una vez solo, con el carril para
  él (coste 2).

---

## 5. Encaje con el PR #1 (reposo, descarga, cierre, sesiones)

- `busy()` de cada herramienta pasa a ser `HAL.jobs.busy(tool)` (más lo que la herramienta tenga abierto sin job, si
  lo hay). `working()` del cierre lista los jobs en marcha y en cola en vez de herramientas.
- **Reposo (30 s):** permitido con jobs `host: "process"` en marcha: el proceso sigue y el runner solo escucha
  líneas. Con un job `host: "page"` en marcha la herramienta no reposa (su página hace el trabajo).
- **Descarga (5 min):** nunca con un job de esa herramienta en cola o en marcha, como hoy.
- **Memoria al minimizar:** `memory_low` solo cuando `jobs.idle()`.
- **Cerrar:** "Quit anyway" cancela todos los jobs (limpio, §4) antes de `app_quit`.
- **Sesiones:** tras un cierre inesperado, los jobs no vuelven; al arrancar, el workspace borra las leases que
  quedaron (§6.1). Reanudar colas tras un fallo queda fuera de alcance.

---

## 6. Workspace

Una raíz fuera de Documentos: `%LOCALAPPDATA%\Halation\workspace\` (no la sincroniza OneDrive y Windows la
considera datos de la app).

```
workspace\
  temp\<job-id>\          carpetas de trabajo (leases)
  cache\frames\           fotogramas y keyframes (hoy framegrab)
  cache\masks\            máscaras de Cutout (hoy Tools\cache\cutout)
  cache\thumbs\           miniaturas de la Library (hoy Tools\cache\library)
  cache\probe\            resultados de ffprobe / análisis por archivo
  cache\proxy\            previsualizaciones (clips de AI Interpolate, audio decodificado)
  index.json              entradas de caché: clave, área, tamaño, último uso, fijado
  stats.json              medidas por kind: pico de RAM / VRAM, duración, pares que no conviene juntar (§4.3)
```

### 6.1 Leases (intermedios)

- `ctx.workdir()` crea `temp\<job-id>` y lo ata al job. Se borra al terminar el job, sea cual sea el final; lo que
  se quiera conservar se mueve antes con `ctx.output`.
- Al arrancar la app se borra todo `temp\*` (ningún job vive entre sesiones).
- AI Interpolate (`interp_workdir`), las descargas parciales y `temp_write` pasan a leases.

### 6.2 Caché común

- Clave por contenido: `fileKey` (LIBRARY_SPEC §3) + tamaño + mtime del archivo de origen, más los parámetros que
  cambian el resultado. El mismo vídeo abierto en Frame Capture, AI Interpolate y el Visualizer comparte probe,
  keyframes y miniaturas.
- `ctx.cache.get(area, key)` / `put(area, key, bytes)`; generaliza `cacheGet` / `cachePut` de Frame Capture y
  `cutout_cache_get` / `_put`.
- **Presupuesto único** (Settings → Storage, defecto 8 GB) con expulsión por menos usado reciente entre todas las
  áreas. Las entradas que usa una herramienta abierta se marcan fijadas y no salen.
- **Disco bajo:** con menos de 5 GB libres en el disco del workspace, la caché baja a la mitad de su presupuesto y
  los jobs `background` que escriben no arrancan.
- **Limpieza:** al arrancar, al terminar cada job, al pasar el presupuesto y con "Clean now" (Settings → Storage).
  "Clean now" vacía `temp` sin lease y toda la caché no fijada.

### 6.3 Modelos

- Los modelos siguen siendo componentes descargables en `Documents\Halation\Tools` (visibles en Settings → Tools):
  upscayl y sus modelos, RIFE `rife-v4.6`, Cutout. El workspace no los copia.
- Un registro (`workspace.rs`) guarda el hash de cada modelo: una segunda descarga del mismo archivo no se hace, y
  dos componentes que traen el mismo modelo lo comparten.
- **En memoria:** la sesión de ONNX de Cutout vive en un único worker compartido (Cutout, Background Remover, lotes
  de Upscale) y se libera tras 2 min sin uso. Ningún modelo se carga dos veces a la vez.

### 6.4 Migración

Una vez: `Tools\cache\cutout` → `cache\masks`, `Tools\cache\library` → `cache\thumbs`,
`%LOCALAPPDATA%\Halation\cache\framegrab` → `cache\frames`; `Tools\temp` se vacía y se elimina; `Settings\Recent`
se resuelve con la Library (LIBRARY_SPEC §4). Si mover falla (disco lleno), se borra: es caché.

---

## 7. Parámetros y valores por defecto

| Parámetro                    | Defecto     | Quiet | Balanced | Fast | Notas                                    |
|------------------------------|-------------|-------|----------|------|------------------------------------------|
| Capacidad `cpu`              | Balanced    | 1     | 2        | 3    | Fast: `max(2, min(4, núcleos/4))`        |
| Capacidad `gpu`              | Balanced    | 1     | 2        | 2    | limitada además por el 80 % de la VRAM   |
| Capacidad `net`              | Balanced    | 1     | 3        | 4    |                                          |
| Capacidad `light`            | —           | 16    | 16       | 16   | tope de seguridad, no una cola real      |
| Unidad de reserva `user`     | +1          |       |          |      | en `cpu` y `gpu`                         |
| Paso de `light` a pesado     | 5 s         |       |          |      |                                          |
| Guardar sitio al primero     | tras 30 s   |       |          |      | evita que el relleno lo deje esperando   |
| Hilos de FFmpeg por job      | —           | ½ núcleos | núcleos ÷ capacidad | núcleos ÷ capacidad | |
| Prioridad de procesos normal | —           | por debajo de normal | normal | normal |                               |
| Reserva de RAM               | 1 GB        |       |          |      | libre tras sumar `ramMB`                 |
| Reserva de disco             | 2 GB        |       |          |      | libre tras sumar `diskMB`                |
| Presupuesto del workspace    | 8 GB        |       |          |      | 2 / 4 / 8 / 16 / 32 GB                   |
| Umbral de disco bajo         | 5 GB libres |       |          |      |                                          |
| Liberar modelo en memoria    | 2 min sin uso |     |          |      |                                          |
| Jobs terminados en memoria   | 50          |       |          |      |                                          |
| Minimizada                   | continue    |       |          |      | continue / pause queued                  |

---

## 8. Qué pasa a ser job

| Herramienta         | Job (`kind`)                        | carril (coste)           | host    | prioridad          |
|---------------------|-------------------------------------|--------------------------|---------|--------------------|
| Audio Visualizer    | `export-video`, `export-layers`     | cpu (gpu con WebCodecs hw) | page | normal             |
| Grade               | `export-image`, `batch` (grupo)     | cpu                      | page    | normal             |
| Frame Capture       | `analyse`, `strip`, `keyframes`     | cpu                      | process | background         |
| Frame Capture       | `open` (primer fotograma)           | light                    | process | user               |
| Downloader          | `download` + `tag` (grupo)          | net / cpu                | process | normal             |
| Image Upscale       | `upscale`, `cutout` (grupo)         | gpu (1–2; cutout 0,5)    | process / page | normal      |
| AI Interpolate      | `extract`, `interpolate`, `assemble` (grupo), `preview` | cpu / gpu / cpu | process | normal (preview: user) |
| Background Remover  | `detect`                            | gpu (0,5)                | page    | user               |
| Cutout (servicio)   | `cutout`                            | gpu (0,5)                | page    | user / normal (lotes) |
| Library             | `index`, `thumbs`                   | light                    | page    | background         |
| Settings → Tools    | `install` (componente)              | net                      | process | normal             |

Cada herramienta mantiene su lista propia (la cola del Visualizer, la de Upscale) como vista filtrada de sus jobs.

---

## 9. Fases de implementación

1. **Núcleo:** `jobs.js` (modelo, planificador, API), `ctx.proc` con kill por job en `procs.rs`, eventos. Upscale,
   AI Interpolate, Downloader y Frame Capture migrados. `busy()` desde jobs.
2. **Jobs en página:** `encoder.js` ligado a jobs; Visualizer, Grade, Cutout y Background Remover.
   Instalaciones de componentes.
3. **Workspace:** `workspace.rs`, leases, caché común con presupuesto, migración de carpetas, registro de modelos,
   worker de ONNX compartido.

Cada fase deja la app funcionando; la bandeja (PROCESS_MENU_SPEC) entra con la fase 1.

---

## 10. Criterios de aceptación

1. En Balanced, un Upscale ×2 de 1080p y un Background Remover corren a la vez en GPU; un RIFE 4K (coste 2) espera
   `waiting` (gpu) hasta que el carril queda libre y, mientras, nadie le adelanta pasados 30 s.
2. En Balanced, a la vez: un Upscale (gpu), dos exports del Visualizer (cpu), tres descargas (net) y los probes y
   miniaturas que hagan falta (light), sin que ninguno de estos últimos espere.
3. Con una GPU de 4 GB, dos upscales cuya VRAM estimada suma más de 3,2 GB no corren juntos.
4. Un cutout pedido sobre la imagen abierta (`user`) arranca aunque el carril GPU esté lleno por un lote.
5. Tras un primer job de un `kind`, la estimación de RAM / VRAM del siguiente usa la medida guardada.
6. Frame Capture analizando un vídeo largo y un export lanzado: el análisis se detiene en su siguiente `yield()` y
   sigue cuando el export termina.
7. Cancelar un job con proceso: el proceso y sus hijos terminan en menos de 1 s, su carpeta `temp\<id>` desaparece,
   y un export parcial se borra.
8. Cancelar un grupo cancela todos sus jobs en cola y en marcha.
9. Tras matar la app a mitad de un job, el siguiente arranque deja `temp` vacío.
10. La caché nunca pasa del presupuesto en más de un 5 % tras la limpieza, y las entradas en uso no se expulsan.
11. El mismo vídeo abierto en Frame Capture y AI Interpolate hace un solo `ffprobe` y guarda una sola vez sus
   keyframes.
12. Con menos RAM libre que `ramMB + 1 GB`, el job espera con `waitingFor: "ram"` en vez de arrancar.
13. Una herramienta con jobs en cola o en marcha no se descarga; con solo jobs de proceso en marcha puede reposar.
14. Cerrar con jobs en marcha pregunta y lista los jobs; "Quit anyway" los cancela limpios.
15. Sin cambios visibles en la vista previa: ningún job bloquea la interacción (traza de `tests/motion.js`, ninguna
    tarea de más de 50 ms en la ventana principal por culpa del planificador).
16. Tests: `tests/jobs.js` nuevo (planificador con recursos simulados en `host.js`: carriles, coste, VRAM,
    relleno, reserva `user`, `light`, cancelación, grupos, yield, RAM / disco), los de cada herramienta migrada, `cargo test` de `workspace.rs` (leases, presupuesto, migración) y
    de `procs.rs` (kill del árbol); `npm run test:real` para la cancelación con procesos reales.

---

## 11. Fuera de alcance

- Pausar un job en marcha (solo retener los que están en cola).
- Persistir la cola entre sesiones o reanudar tras un fallo.
- Jobs en varios equipos o en la nube (restricción fija).
- Medición de VRAM por proceso en jobs de página (WebGPU no la expone): usan la estimación y el total del sistema.
- Planificación por horario ("exportar esta noche").
- Codificadores por hardware en FFmpeg (ROADMAP): encajan como jobs `gpu` cuando se hagan.
