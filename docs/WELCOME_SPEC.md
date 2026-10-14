# Welcome — Especificación v1

El Welcome (`#welcome`, `shell.js` → `welcome`) es hoy una tarjeta de 660 px en el centro de una ventana maximizada:
idioma, una frase de presentación, el nombre de artista y sus perfiles. Esta especificación lo convierte en un
**menú de bienvenida a pantalla completa**, con un índice de pasos a la izquierda y contenido amplio a la derecha, que
además de presentar Halation deja configuradas las decisiones que hoy se piden más tarde y a destiempo (dónde se
guarda, qué herramientas se usan, qué se descarga, cómo se ve el dock). Idea de Java: 2026-10-14 ("ahora el menú de
welcome es muy poco menú, es como una pestañita, pequeña; debería ser más grande, más diverso y funcional").

Estado: borrador, pendiente de aprobación de Java. Nada implementado.

---

## 0. Principios

1. **Un menú, no un diálogo.** Ocupa la ventana como una página propia, con navegación visible entre secciones; no
   es una tarjeta flotando sobre un fondo vacío.
2. **Cada paso deja algo hecho.** Todo lo que se elige en el Welcome escribe un ajuste real que ya existe en
   Settings; nada es decorativo. Lo que no se toque se queda en el valor por defecto que funciona.
3. **Saltable entero y por partes.** "Skip setup" desde cualquier paso lleva a Ready con los valores por defecto; cada
   paso tiene "Skip" propio. Nunca bloquea la entrada a la app.
4. **Un solo sitio por decisión** (`SETTINGS_SPEC.md` §0). El Welcome no crea opciones nuevas: escribe las claves de
   Settings y lleva a ellas. Cambiar algo después se hace en Settings o volviendo a abrir el Welcome (§5).
5. **Mismo lenguaje visual.** Paleta Graphite de `tokens.css`, burbujas como el resto de la app, fondo Cáusticas de
   `welcome-background.js` detrás (`BACKGROUNDS_SPEC.md` §2), movimiento solo con `motion.js` (`MOTION.md`).

---

## 1. Qué hay hoy

- Fases (`data-phase`): `seed` (logo solo, 220 × 220) → `language` (solo si no hay idioma guardado) → `welcome`
  (título, frase, "Create · Refine · Release") → `identity` (nombre) → `profiles` (perfiles encontrados) → `ready`
  ("You're ready", botón "Enter Halation").
- `.wl-object`: `width: min(660px, 100%)`, padding 44/48 px, superficie con el degradado `--welcome-surface-*`.
  Progreso de tres guiones. Botones "Skip setup" y "Get started".
- Salida: la superficie se extiende a toda la ventana y el logo pasa al héroe de Home (`welcome-logo-handoff`).
- Solo aparece en el primer arranque (`st.firstRun`); no se puede volver a abrir.

### Problemas

1. **Se siente pequeño.** La ventana abre maximizada (`WINDOW_SPEC.md` §2): en 1920 × 1080 la tarjeta ocupa un tercio
   del ancho y el resto es fondo. Parece un aviso, no la entrada a una app.
2. **Dice poco.** La presentación son tres palabras; no enseña qué herramientas hay ni para qué sirve cada una.
3. **Configura poco.** Solo pide nombre. Las decisiones del primer uso llegan después y en mal momento: la carpeta de
   guardado en la primera exportación (`SAVE_LOCATION_SPEC.md`), los componentes al abrir una herramienta que no los
   tiene, el modo del dock y el rendimiento escondidos en Settings.
4. **No hay vuelta atrás.** Sin botón Back, sin índice, sin reabrirlo.
5. **Bug de flujo:** el idioma se guarda en el primer paso; si la app se cierra antes de terminar, el siguiente
   arranque ya no es `firstRun` y el Welcome no vuelve (§4 lo corrige).

---

## 2. Distribución

Escenario a pantalla completa (el `<dialog>` sigue siendo `inset: 0`). Encima del fondo Cáusticas, **un objeto
grande** con dos columnas:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ┌───────────────────┐ ┌──────────────────────────────────────────────────────────────┐ │
│ │  (logo) HALATION  │ │  STEP 3 OF 6                                                 │ │
│ │                   │ │  Pick your tools                                             │ │
│ │  ✓ Language       │ │  Halation shows only what you use. Change it anytime.        │ │
│ │  ✓ Welcome        │ │                                                              │ │
│ │  ✓ You            │ │  [ All ] [ Music ] [ Image ] [ Video ] [ Custom ]            │ │
│ │  ● Tools          │ │                                                              │ │
│ │  ○ Files & work   │ │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │ │
│ │  ○ Interface      │ │  │ ⤓ Down-  │ │ ⇄ Conv-  │ │ 🎤 Vocal │ │ ∿ Visua- │         │ │
│ │                   │ │  │ loader ✓ │ │ erter ✓  │ │ Rem.  ✓  │ │ lizer ✓  │  …      │ │
│ │                   │ │  └──────────┘ └──────────┘ └──────────┘ └──────────┘         │ │
│ │                   │ │                                                              │ │
│ │                   │ │  To download: 8 components · ≈ 530 MB            [● Now]     │ │
│ │                   │ │                                                              │ │
│ │  Skip setup       │ │  ← Back                              Skip    [ Continue ]    │ │
│ └───────────────────┘ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **Objeto:** ancho `clamp(920px, 82vw, 1320px)`, alto `clamp(580px, 84vh, 860px)`, centrado, margen mínimo de 24 px
  a los bordes de la ventana. Radio `--r-bubble`. Las dos columnas son burbujas separadas por 12 px (mismo patrón que
  el dock y el contenido de las herramientas), no un único panel.
- **Índice (izquierda), `welcomeIndexWidth` = 260 px:** marca y palabra HALATION arriba (el logo que hoy vive en la
  tarjeta), lista de pasos (icono de estado + nombre; ✓ hecho, ● actual, ○ pendiente, "–" saltado), "Skip setup" al
  pie. Los pasos ya vistos son clicables; los pendientes no (se llega en orden la primera vez). Píldora de selección
  con `glide`, como el dock. Superficie `--surface` con `--line-soft`.
- **Contenido (derecha):** cabecera (antetítulo `--text-3` "Step N of 6", `h1` 34 px, entradilla `--text-2`), cuerpo
  con scroll propio si no cabe, pie fijo con "← Back" a la izquierda y "Skip" + botón primario a la derecha. Superficie
  con el degradado `--welcome-surface-high → mid → low` de hoy.
- **Ventanas estrechas** (ancho < `welcomeCompactWidth` = 1100 px lógicos): el índice se pliega a una barra
  horizontal encima del contenido (nombres de pasos como píldoras, la actual resaltada); el objeto pasa a ocupar la
  ventana menos 16 px. Debe verse completo, sin scroll de página, en 960 × 640 (mínimo de la ventana).
- **Colores:** solo tokens existentes. Acento `--accent` (lavanda) para la selección, el paso actual y los
  interruptores; `--primary` para el botón Continue/Enter; `--ok` para los ✓. Sin colores nuevos salvo que se vea que
  hacen falta (se añadirían en `tokens.css`).

---

## 3. Pasos

Seis pasos y una pantalla final. Orden fijo. El antetítulo cuenta los seis.

### 3.0 Semilla (sin cambios)

El logo solo, 220 × 220, sobre el fondo; luego la geometría crece hasta el objeto grande (§7). Igual que hoy.

### 3.1 Language

- Dos tarjetas grandes en lugar de dos radios: "English" y "Español", cada una con una frase de muestra en su idioma
  ("A creative workspace built around your music." / "Un espacio creativo construido alrededor de tu música.").
- Preseleccionada la del idioma del sistema (`navigator.language`), con `en` como reserva.
- Elegir una tarjeta cambia el idioma de todo el Welcome al momento (sin esperar a Continue). Guarda `language`.
- Se muestra siempre en el primer arranque (hoy solo si falta el idioma, que en primer arranque es siempre).

### 3.2 Welcome (qué es Halation)

- Título "Welcome to Halation", entradilla de hoy (`welcome.introText`).
- **Mapa de herramientas** construido de `MODULES` (`modules.js`), agrupado por `group` como el dock, con un título por
  grupo: *Get files* (Downloader, Converter), *Audio* (Vocal Remover, Audio Visualizer), *Image* (Grade, Cover Test,
  Background Remover, Upscale), *Video* (AI Interpolate, Frame Capture), y Library aparte.
- Cada herramienta: icono Lucide, nombre (`tab.<id>`) y la descripción de su tarjeta de Home (`home.d.<id>`). Insignia
  "Beta" para `stage: "beta"`. Sin interacción más allá del hover (el paso es para leer).
- Cuatro columnas en ≥ 1280 px, dos en compacto.

### 3.3 You

Une los pasos `identity` y `profiles` de hoy en uno.

- Campo de nombre de artista grande (el `#wName` de hoy).
- A su derecha (debajo en compacto), una **vista previa**: avatar (inicial si no hay perfil), el nombre, y los
  perfiles confirmados como chips con su icono de plataforma.
- Botón "Find my profiles" (no busca solo al escribir). Resultados en lista debajo, con "That's me" / "Not me" como
  hoy (`findProfiles`, `pickProfile`). Sin conexión o sin resultados: el mensaje de hoy, en la misma vista.
- Guarda `artistName` y `links`. Nota "You can change this anytime in Settings → You".

### 3.4 Tools

- **Presets** en una fila segmentada: *All* (por defecto), *Music*, *Image*, *Video*, *Custom* (§6).
- **Rejilla de tarjetas**, una por módulo no `core` (`MODULES` sin `home`/`settings`), con icono, nombre, interruptor
  y, debajo, sus componentes obligatorios con tamaño (`COMPONENTS[].mb`), en `--text-3`. Tocar una tarjeta cambia el
  preset a *Custom*.
- **Resumen de descarga** al pie del cuerpo: componentes obligatorios que faltan para las herramientas activas,
  sin repetir (FFmpeg cuenta una vez), con el total aproximado (con *All*, 8 componentes, ≈ 530 MB), y un interruptor **"Download now"**
  (`welcomeDownloadNow`, por defecto activado). Los opcionales no se descargan aquí.
- Al continuar: guarda `modules` (`false` para cada herramienta apagada; las encendidas sin clave, como hoy) y, si
  "Download now" está activo, encola la instalación de cada componente por el camino de Settings → Tools
  (`tool_install`, jobs con `tool = "settings"`); el progreso se ve en el dock (marca de Settings) y en el menú de
  procesos. Nada espera a que terminen.
- Sin conexión: el interruptor se desactiva con la nota "You're offline. Halation will offer each download when a tool
  needs it."
- Al menos una herramienta debe quedar activa; si se apagan todas, Continue se desactiva con la nota correspondiente.

### 3.5 Files & work

Tres bloques, cada uno con su control grande:

1. **Where your exports go** (`saveMode`): dos tarjetas, *Ask every time* (recomendada, preseleccionada) y *Halation
   folder*, que muestra la ruta real (`Documents\Halation`) y una línea con la organización de subcarpetas
   (`SAVE_LOCATION_SPEC.md`). Guarda `saveMode` y `saveLocationChosen = true`, así la primera exportación ya no
   pregunta.
2. **Performance** (`processing.mode`): segmentado *Quiet* / *Balanced* (por defecto) / *Fast* con la nota de Settings
   (`set.proc.note.*`, con los números reales de este PC), y el interruptor "Use the graphics card"
   (`processing.gpu`, por defecto activado).
3. **Notifications** (`notifyDone`): interruptor "Notify me when a job finishes" (por defecto activado).

### 3.6 Interface

1. **Dock** (`dockMode`): tres tarjetas con una miniatura dibujada en CSS del dock en cada modo — *Compact*,
   *Expand over content* (por defecto), *Keep open* — con la frase de `DOCK_SPEC.md` §5.
2. **When Halation opens** (`openMode`): *Where I left it* (por defecto, `last`) / *Maximized* / *Full screen*.
3. **Motion** (`reduceMotion`): interruptor "Reduce motion". Al activarlo, el propio Welcome pasa a movimiento
   reducido al momento.

### 3.7 Ready

- Título "You're ready.", entradilla con el nombre si lo hay ("Everything is set, {name}.").
- **Resumen** en dos columnas: una línea por paso con lo elegido (idioma, nombre, N herramientas, descargas en curso,
  modo de guardado, rendimiento, dock) y un enlace "Edit" que vuelve a ese paso.
- **Start with**: hasta cuatro baldosas grandes de acción, solo de herramientas activas:
  - *Make a video from a song* → Audio Visualizer y su selector de audio.
  - *Download from a link* → Downloader con el foco en el campo de enlace.
  - *Edit a cover* → Grade y su selector de imagen.
  - *Split vocals* → Vocal Remover y su selector de audio.
  Si hay menos de cuatro herramientas activas, se rellenan con las primeras activas en orden de `MODULES`.
- Botón primario grande "Enter Halation" (el de hoy, 56 px de alto) → Home con el traspaso del logo actual.
  Una baldosa de acción sale directamente a esa herramienta (§7) sin pasar por Home.

---

## 4. Cuándo aparece

- **Primer arranque:** como hoy (`st.firstRun`), y además si `onboarding.done` es `false` (la app se cerró a mitad):
  vuelve al paso guardado en `onboarding.step`, con lo ya elegido.
- **Usuarios existentes** (hay `settings` sin `onboarding`): la migración escribe `onboarding = { done: true,
  version: 0 }` y no se les muestra.
- **Reabrir:** Settings → General → "Run setup again" (`set.runWelcome`). Modo revisión: sin semilla (aparece con el
  `--place` normal de un diálogo), todos los pasos marcados como hechos y clicables, valores leídos de `settings`, Esc
  cierra sin tocar nada más, el botón final es "Done" y vuelve a Settings. Los cambios se guardan al pulsar Continue
  en cada paso, igual que en el primer arranque.

---

## 5. Modelo de datos

Clave nueva en `DEFAULT_SETTINGS` (`shell.js`):

```js
onboarding: {
  version: 1,        // versión del Welcome que se completó (0 = usuario anterior a esta spec)
  done: false,       // true al pulsar Enter Halation, una baldosa de Start with, o Skip setup
  step: "language",  // último paso visto: language | welcome | you | tools | files | interface | ready
  skipped: []        // pasos saltados con Skip (solo para el índice: muestran "–")
}
```

Estado del flujo, solo en memoria (sección `/* ===== welcome ===== */` de `shell.js`):

```js
{
  mode: "first" | "revisit",
  step: "tools",
  preset: "all",                 // all | music | image | video | custom
  modules: { stems: true, … },   // borrador del paso Tools hasta Continue
  downloadNow: true,
  profiles: [ … ]                // resultados de findProfiles
}
```

Claves existentes que escribe: `language`, `artistName`, `links`, `modules`, `saveMode`, `saveLocationChosen`,
`processing.mode`, `processing.gpu`, `notifyDone`, `dockMode`, `openMode`, `reduceMotion`. Cada una con el mismo
setter que usa Settings (`setSetting`, `setProc`), para que Settings y el Welcome no diverjan.

---

## 6. Parámetros y presets

| Parámetro | Por defecto | Valores | Qué hace |
|---|---|---|---|
| `welcomeWidth` | `clamp(920px, 82vw, 1320px)` | CSS | ancho del objeto (constante) |
| `welcomeHeight` | `clamp(580px, 84vh, 860px)` | CSS | alto del objeto (constante) |
| `welcomeIndexWidth` | `260` | px | columna del índice (constante) |
| `welcomeCompactWidth` | `1100` | px lógicos | por debajo, el índice pasa arriba (constante) |
| `welcomePreset` | `"all"` | `all` · `music` · `image` · `video` · `custom` | preset inicial del paso Tools |
| `welcomeDownloadNow` | `true` | bool | descargar los componentes obligatorios al continuar |
| `saveMode` preseleccionado | `"ask-every-time"` | según `SAVE_LOCATION_SPEC.md` | |
| `processing.mode` | `"balanced"` | `quiet` · `balanced` · `fast` | ya existe |
| `dockMode` | `"overlay"` | `compact` · `overlay` · `pinned` | ya existe |
| `openMode` | `"last"` | `last` · `maximized` · `fullscreen` | ya existe |

Presets del paso Tools (Library está siempre activa en todos):

| Preset | Herramientas activas |
|---|---|
| All | todas |
| Music | Downloader, Converter, Vocal Remover, Audio Visualizer, Grade, Cover Test |
| Image | Grade, Cover Test, Background Remover, Upscale, Converter |
| Video | Downloader, Converter, AI Interpolate, Frame Capture, Upscale |
| Custom | lo que el usuario marque |

Textos nuevos solo en `en.json` (prefijo `welcome.`): títulos y entradillas de cada paso, `welcome.stepOf`,
`welcome.back`, `welcome.skip`, nombres de grupo del mapa, presets, `welcome.downloadNow`, `welcome.downloadTotal`,
`welcome.offlineDownloads`, `welcome.needOneTool`, textos de Files/Interface que no existan ya en `set.*` (se reusan
las claves de Settings donde dicen lo mismo), resumen y baldosas de Ready, `welcome.done`, `set.runWelcome`. Se borran
las claves que dejen de usarse (`welcome.step1..3`, `welcome.create/refine/release`, etc.).

---

## 7. Movimiento (`MOTION.md`)

- **Entrada:** semilla igual que hoy; la geometría crece de 220 × 220 al objeto grande con `--place`; luego índice y
  contenido entran con `opacity` + `translateY(8px)` en `--stagger`.
- **Cambio de paso:** el índice mueve su píldora con `glide`; el contenido sale con `--fade` y el nuevo entra con
  `translateX(±16px)` según la dirección (adelante/atrás), `--spring`. Las tarjetas de un paso entran en `--stagger`.
  Interrumpible: un clic rápido en otro paso parte de donde está (`carry`).
- **Tarjetas seleccionables** (idioma, presets, guardado, dock): la selección es un borde `--accent-line` y fondo
  `--accent-dim` que se desliza entre tarjetas con `glide`, no un parpadeo.
- **Salida "Enter Halation":** la de hoy (superficie a toda la ventana, logo al héroe de Home).
- **Salida a una herramienta (Start with):** la superficie se funde (`--fade`) y la herramienta entra con su
  `reveal` normal; sin traspaso del logo.
- Solo `transform` y `opacity`; sin animar `width`/`height` (el crecimiento de la semilla es un FLIP de escala como
  hoy). Movimiento reducido: fundidos cortos, sin desplazamientos, fondo Cáusticas fijo.

---

## 8. Teclado y accesibilidad

- Enter = Continue (salvo dentro de la lista de perfiles). Alt+← / Alt+→ = Back / Continue. Esc: en primer arranque
  pide confirmar "Skip setup?" en línea (no un diálogo encima); en revisión cierra.
- El índice es un `<nav>` con `aria-current="step"`; al cambiar de paso el foco va al `h1` del paso.
- Tarjetas seleccionables = `radiogroup` con flechas; tarjetas de Tools = `checkbox`.
- Contraste AA de `--text-3` sobre las superficies del Welcome (comprobar; si no llega, `--text-2`).

---

## 9. Código

- `index.html`: `#welcome` reestructurado (índice + contenido + un `<section>` por paso).
- `shell.js`: la sección del Welcome pasa a `/* ===== welcome ===== */` con funciones por paso (`paintLanguage`,
  `paintTour`, `paintYou`, `paintTools`, `paintFiles`, `paintInterface`, `paintReady`), `WELCOME_PRESETS`,
  `goWelcome(step, dir)`, `S.runWelcome()`; `DEFAULT_SETTINGS.onboarding` y su migración; el botón en Settings →
  General.
- `shell.css`: estilos `.wl-*` nuevos; se borran los de la tarjeta de 660 px que no se usen.
- `motion.js`: `welcomeFlow` con la geometría del objeto grande y el cambio de paso direccional.
- `locales/en.json`: claves de §6.
- `docs/ARCHITECTURE.md`: entrada del Welcome en el mapa de `shell.js`.
- Sin Rust: instalar componentes, buscar perfiles y guardar ajustes ya existen.

---

## 10. Pruebas

Playwright con `host.js`:

- Primer arranque completo: cada paso guarda su clave; Ready muestra el resumen correcto; Enter Halation lleva a Home.
- Skip setup desde cada paso: valores por defecto, `onboarding.done = true`.
- Cerrar a mitad y reabrir: vuelve al paso guardado con lo elegido.
- Usuario existente: no aparece; Settings → Run setup again lo abre en modo revisión con los valores actuales.
- Presets: cada uno deja `modules` como en §6; tocar una tarjeta pasa a Custom; no se puede apagar todo.
- Download now: encola un job por componente obligatorio que falta, sin duplicados; desactivado sin conexión.
- `saveMode` elegido: la primera exportación ya no muestra el diálogo de elección.
- Baldosa de Start with: abre la herramienta correcta y su selector; solo aparecen herramientas activas.
- Idioma: cambiar la tarjeta traduce el Welcome al momento.
- Teclado: Enter, Alt+←/→, Esc; foco en el `h1` al cambiar de paso.
- Movimiento reducido: sin desplazamientos.

Capturas (`$SHOTS`): cada paso en 960 × 640, 1366 × 768 y 1920 × 1080; Tools con cada preset; Ready con y sin nombre.

---

## 11. Criterios de aceptación

1. En 1920 × 1080 maximizada el Welcome ocupa al menos el 75 % del ancho y se lee como un menú con secciones.
2. En 960 × 640 se ve entero, sin scroll de página ni texto cortado (el cuerpo de un paso puede tener scroll propio).
3. Todos los ajustes elegidos aparecen igual en Settings al entrar; cambiar uno en Settings se refleja al reabrir el
   Welcome.
4. Ningún paso es obligatorio: Skip setup entra a la app con los valores por defecto.
5. La primera exportación no pregunta dónde guardar si se eligió en el Welcome.
6. Las descargas de componentes elegidas están en marcha al entrar en la app y se ven en el dock y en el menú de
   procesos.
7. Colores solo de `tokens.css`; movimiento solo de `motion.js`; sin coste de GPU mayor que el Welcome actual.
8. Tests de §10 en verde y OK visual de Java en Preview (KernelPanic).

---

## 12. Fuera de alcance

- Cuentas, inicio de sesión o sincronización en la nube (prohibido por `CLAUDE.md`).
- Tutoriales dentro de las herramientas (marcas de "haz clic aquí", recorridos guiados).
- Mostrar el Welcome nuevo a usuarios existentes tras actualizar (para eso está "What's new").
- Cambiar el fondo Cáusticas o el de Home (Drape).
- Elegir tema o colores (hay un solo tema, Graphite).
- Ajustes avanzados de Settings (límites de jobs, plantillas de nombre, presupuesto de caché, Vocal Remover GPU/CPU).
- `es.json` (solo cuando Java diga "actualizar español").

---

## 13. Decisiones abiertas (con la opción por defecto ya elegida)

| Pregunta | Por defecto en esta spec | Alternativa |
|---|---|---|
| ¿Descargar componentes en el Welcome? | Sí, activado, con tamaño visible (≈ 530 MB con *All*) | Apagado por defecto; solo listar |
| ¿Mantener el paso Welcome (mapa de herramientas)? | Sí | Fundirlo con Tools (5 pasos) |
| ¿Mostrar el Welcome a usuarios existentes una vez? | No | Sí, en modo revisión tras actualizar |
| ¿Baldosas Start with en Ready? | Sí, 4 | Solo "Enter Halation" |
