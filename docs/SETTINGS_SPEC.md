# Settings — Especificación v1

> Save/export location behavior, mode names, and batch rules are superseded by [SAVE_LOCATION_SPEC.md](SAVE_LOCATION_SPEC.md).

Settings como centro de preferencias mínimo: solo decisiones globales sobre cómo funciona Halation, lo esencial a la
vista y lo avanzado aparte, y las configuraciones de cada herramienta dentro de su herramienta. Idea de Java:
2026-09-30. Parte del estado de la rama `claude/project-thread-fvshc6` (pestañas arriba en un recuadro a todo el
ancho, apartado Artist).

---

## 0. Principios

1. **Global o fuera.** Una opción vive en Settings solo si cambia cómo funciona Halation en más de una herramienta o
   la app en sí. Lo que afecta a una sola herramienta vive en esa herramienta.
2. **Esencial primero.** Cada sección muestra lo que un usuario normal toca; lo avanzado queda plegado detrás de
   "Advanced" y nunca es necesario para usar la app.
3. **Sin opciones huérfanas.** Toda opción tiene un efecto visible y un valor por defecto que funciona. Si nadie la
   tocaría, no existe.
4. **Un solo sitio por decisión.** Ninguna opción aparece a la vez en Settings y en una herramienta.

---

## 1. Qué hay hoy y adónde va

Estado actual (`index.html` → `#v-settings`, `shell.js` → settings; `DEFAULT_SETTINGS`):

| Hoy (sección → opción)                        | Clave                         | Destino                                             |
|-----------------------------------------------|-------------------------------|-----------------------------------------------------|
| General → Artist (nombre, enlaces, buscar)    | `artistName`, `links`         | Settings → **You** (esencial)                       |
| General → Saving (directo / preguntar)        | `saveMode`                    | Settings → **Files** (esencial)                     |
| General → Naming (plantillas vídeo / imagen)  | `videoName`, `imageName`      | Settings → **Files** (avanzado)                     |
| General → Interface (idioma, menos animación) | `language`, `reduceMotion`    | Settings → **General** (esencial)                   |
| General → Notifications (probar)              | —                             | Settings → **General** → interruptor "Notify when a job finishes" (esencial); el botón de prueba pasa a avanzado |
| Export → Video: formato, fps, calidad         | `videoFormat/Fps/Quality`     | **Audio Visualizer** → diálogo de exportación, "Use as default" |
| Export → Video: códec vídeo / audio           | `videoCodec`, `audioCodec`    | **Audio Visualizer** → exportación, avanzado (solo lo usa `encodeWebCodecs`) |
| Export → Video: encoder (auto / CPU)          | `encoder`                     | Settings → **Processing** → "Use the GPU" (esencial; ver JOBS_SPEC) |
| Export → Image: tamaño, formato               | `imageSize`, `imageFormat`    | **Grade** → exportación, "Use as default"           |
| Tools → Modules                               | `modules`                     | Settings → **Tools** (esencial)                     |
| Tools → Components (+ Update engine)          | —                             | Settings → **Tools** (esencial; actualizar en avanzado) |
| Tools → Packs                                 | —                             | **Library** → sección Packs (instalar / quitar desde allí) |
| Storage (tamaños, limpiar, caché de fotogramas)| `frameCacheMB`               | Settings → **Storage**; el límite de caché pasa al presupuesto del workspace (JOBS_SPEC §6) |
| About → Folders, Previous versions, About     | —                             | Settings → **About**                                |
| Botón "Restore defaults"                      | —                             | Se mantiene arriba a la derecha                     |

---

## 2. Distribución

Mismo patrón de página que la rama de Settings/Library: barra de pestañas arriba en un recuadro a todo el ancho,
secciones como tarjetas debajo, la pestaña visible marcada al desplazarse.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [General] [You] [Files] [Processing] [Tools] [Storage] [About]   ⟲ Restore   │
├──────────────────────────────────────────────────────────────────────────────┤
│ GENERAL                                                                      │
│  Language            [English ▾]                                             │
│  Reduce animations   [ ○ ]                                                   │
│  Notify when a job finishes  [ ● ]                                           │
│  ▸ Advanced  (Send a test notification)                                      │
│                                                                              │
│ YOU                                                                          │
│  Artist name  [__________]   Links ...   [Search other sites]                │
│                                                                              │
│ FILES                                                                        │
│  (•) Save straight to Exports   ( ) Ask where each time                      │
│  Exports folder  Documents\Halation\Exports   [Open]                         │
│  ▸ Advanced  (plantillas de nombre + vista previa)                           │
│                                                                              │
│ PROCESSING                                                                   │
│  Mode  [Balanced ▾]   (Quiet · Balanced · Fast)                              │
│  Use the GPU  [ ● ]                                                          │
│  ▸ Advanced  (trabajos a la vez, cuando está minimizada)                     │
│ ...                                                                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **General:** idioma, reducir animaciones, notificar al terminar un trabajo.
- **You:** apartado Artist tal como está en la rama (nombre, enlaces, "Search other sites"). Renombrado "You" para
  separar identidad de preferencias; si Java prefiere "Artist", se queda "Artist".
- **Files:** modo de guardado; la carpeta de exportación visible con "Open". Avanzado: plantillas de nombre.
- **Processing:** nuevo. Las decisiones globales del sistema de jobs (JOBS_SPEC §7): modo, GPU. Avanzado: trabajos a
  la vez por recurso, comportamiento al minimizar.
- **Tools:** módulos activados y componentes descargables (estado, tamaño, instalar / quitar). Avanzado: "Update
  engine" (yt-dlp) y abrir la carpeta Tools.
- **Storage:** uso de disco (app, componentes, workspace, contenido del usuario), "Clean now", presupuesto del
  workspace (JOBS_SPEC §6). Avanzado: el desglose por caché.
- **About:** versión, logo, carpetas, datos de versiones anteriores.
- **"Advanced":** un `details` por sección (motion.js `details`), cerrado por defecto; su estado abierto / cerrado
  se recuerda por sección.

### 2.1 Configuración dentro de cada herramienta

- Lo que sale de Settings entra en el diálogo o panel de exportación de su herramienta como valor inicial, con un
  enlace "Use as default" que lo guarda como defecto de esa herramienta.
- Una herramienta que no tiene defectos guardados usa los de fábrica (los de `DEFAULT_SETTINGS` actuales).
- Settings no enlaza a opciones de herramientas ni las repite.

---

## 3. Modelo de datos

`Settings\app.json`, clave `settings` (versión 2) y una clave nueva por herramienta con sus defectos:

```json
{
  "settings": {
    "version": 2,
    "language": "en",
    "reduceMotion": false,
    "notifyDone": true,
    "artistName": "", "links": {},
    "saveMode": "direct",
    "videoName": "{title}.mp4", "imageName": "{title}.png",
    "processing": { "mode": "balanced", "gpu": true, "minimized": "continue", "limits": null },
    "workspace": { "budgetMB": 8192 },
    "modules": {},
    "advancedOpen": {}
  },
  "toolDefaults": {
    "visualizer": { "format": "1920x1080", "fps": "30", "quality": "std", "videoCodec": "auto", "audioCodec": "auto" },
    "grade":      { "imageSize": "3000", "imageFormat": "png" }
  }
}
```

- `processing.limits: null` significa "según el modo" (JOBS_SPEC §7); un objeto `{ cpu, gpu, disk }` fija los
  límites a mano (solo desde Advanced).
- `encoder: "cpu"` de la v1 se traduce a `processing.gpu: false`.
- `frameCacheMB` desaparece: el presupuesto único del workspace lo sustituye (el valor antiguo, si es mayor que el
  presupuesto por defecto, se toma como presupuesto).
- API: `__hal.settings()` sigue devolviendo el objeto plano; nuevo `__hal.toolDefaults(id)` y
  `__hal.setToolDefaults(id, obj)`, con evento `toolDefaults` para la herramienta afectada.

### 3.1 Migración

Una vez, al leer `settings` sin `version`: `videoFormat/Fps/Quality/videoCodec/audioCodec` →
`toolDefaults.visualizer`; `imageSize/imageFormat` → `toolDefaults.grade`; `encoder` → `processing.gpu`;
`frameCacheMB` → `workspace.budgetMB` (según la regla de arriba). Las claves antiguas se borran. Idempotente.

---

## 4. Parámetros y valores por defecto

| Opción                        | Sección    | Nivel     | Defecto     | Valores                                   |
|-------------------------------|------------|-----------|-------------|-------------------------------------------|
| Language                      | General    | esencial  | `en`        | `en`, `es`                                |
| Reduce animations             | General    | esencial  | off         | on / off (y `prefers-reduced-motion`)     |
| Notify when a job finishes    | General    | esencial  | on          | solo si la ventana no está a la vista     |
| Send a test notification      | General    | avanzado  | —           | botón                                     |
| Artist name, links            | You        | esencial  | vacío       | como en la rama                           |
| Saving                        | Files      | esencial  | direct      | direct / ask                              |
| Name templates                | Files      | avanzado  | `{title}.mp4` / `{title}.png` | como hoy                  |
| Mode                          | Processing | esencial  | balanced    | quiet / balanced / fast                   |
| Use the GPU                   | Processing | esencial  | on          | on / off                                  |
| Jobs at once (CPU, GPU, disk) | Processing | avanzado  | según modo  | 1–4 / 1–2 / 1–3                           |
| When minimized                | Processing | avanzado  | continue    | continue / pause queued                   |
| Modules on / off              | Tools      | esencial  | todos on    | como hoy                                  |
| Workspace budget              | Storage    | esencial  | 8 GB        | 2, 4, 8, 16, 32 GB                        |

---

## 5. Criterios de aceptación

1. Settings no contiene ninguna opción que afecte a una sola herramienta (revisión con la tabla §1).
2. Sin abrir ningún "Advanced", cada sección muestra como mucho cuatro controles.
3. Formato, fps, calidad y códecs del Visualizer se eligen en su exportación; "Use as default" los mantiene tras
   reiniciar; Settings no los muestra.
4. Tamaño y formato de imagen de Grade, igual en Grade.
5. Un `app.json` de la 0.9.0 migra sin perder valores: los defectos del Visualizer y de Grade salen como estaban.
6. "Restore defaults" restaura Settings y no toca identidad (nombre, enlaces), idioma, módulos ni `toolDefaults`.
7. Las pestañas siguen el patrón de la rama (recuadro a todo el ancho, pestaña visible marcada); pill del segmented
   alineada en inglés y español (`tests/segmented.js`).
8. Todo texto nuevo en `en.json`; animaciones solo con `motion.js`.
9. Tests: `tests/settings` (flujo y migración), `tests/segmented.js`, y los de exportación del Visualizer y Grade
   que leen defectos.

---

## 6. Fuera de alcance

- Perfiles o conjuntos de ajustes guardables.
- Búsqueda dentro de Settings.
- Sincronización entre equipos (sin nube: restricción fija).
- Atajos de teclado configurables.
- Tema claro (la marca es oscura).

## 7. Decisiones abiertas (valor por defecto elegido)

- Nombre de la sección de identidad: **You** (alternativa: mantener "Artist").
- Packs: se gestionan desde la Library (alternativa: seguir en Settings → Tools como componentes).
