# Tamaño de la ventana — Especificación v1

> Historical, not authoritative: describes the Tauri app (in force until 1.2.0, on `main`).

Cómo se abre la ventana principal, qué tamaño mínimo admite y cómo se recuerda. Referencia: editores de escritorio
tipo CapCut, que abren ocupando la pantalla porque el trabajo creativo necesita sitio. Idea de Java: 2026-10-14
("que la app se abra más ancha por default; en pantalla completa o lo que mejor experiencia dé").

Estado: aprobada (Java, 2026-10-14) e implementada en 1.2.0. Lo que cambió al implementar está en §10.

---

## 1. Qué hay hoy

- `tauri.conf.json`: ventana de **1480 × 940** lógicos, mínimo **960 × 640**, centrada, `visible: false` hasta que
  `restore_window` la muestra.
- `window.rs` → `save_window` guarda en `app.json` (`window`) la posición exterior y el tamaño interior **en píxeles
  físicos**, y `maximized`. `restore_window` los vuelve a aplicar si el tamaño es ≥ 600 × 400 físicos y la posición
  cae dentro de algún monitor; luego maximiza si estaba maximizada.
- No hay pantalla completa ni ajuste de cómo abrir.

### Problemas

1. **El tamaño por defecto no cabe en pantallas habituales.** Un portátil 1920 × 1080 al 150 % tiene un área útil de
   unos 1280 × 680 lógicos (cifra aproximada: depende de la barra de tareas); 1366 × 768 al 100 %, unos 1366 × 728.
   1480 × 940 sale por los dos lados y la barra de título puede quedar fuera.
2. **El tamaño guardado no se ajusta al monitor.** Se guarda en físicos y no se recorta al área útil: al cambiar de
   monitor, de escala o de resolución, la ventana vuelve más grande que la pantalla o diminuta.
3. **En pantallas grandes abre pequeña.** En 2560 × 1440 al 100 % ocupa algo más de la mitad; las herramientas
   (Grade, Visualizer, Frame Capture) tienen sitio de sobra que no usan.

### Referencia (CapCut)

- Inferido (no verificado contra su código ni documentación): CapCut para escritorio abre maximizada, recuerda si se
  dejó en ventana y tiene un mínimo alto porque su editor no se pliega. No hay cifras públicas fiables de su mínimo;
  si hacen falta, se miden en Windows antes de implementar.
- Lo que se toma: abrir maximizada la primera vez, recordar lo que el usuario deje, y no abrir nunca más grande que
  la pantalla. Lo que no: un mínimo alto. Halation tiene herramientas pequeñas (Downloader, Converter) que sirven en
  una ventana a media pantalla.

---

## 2. Decisión: maximizada, no pantalla completa

- **Por defecto: maximizada.** Ocupa todo el área útil y conserva barra de título (encajes de Windows 11, minimizar,
  cerrar), barra de tareas y arrastrar archivos desde el Explorador, que es como entra casi todo en Halation.
- **Pantalla completa: opcional**, con F11 o el ajuste. Oculta barra de título y de tareas; útil para revisar un
  visualizer o un grade sin distracciones, peor como estado por defecto (no se ve el reloj ni otras ventanas y el
  arrastre desde el Explorador queda incómodo).

---

## 3. Comportamiento

### Primer arranque (no hay `window` en `app.json`)

1. Se calcula el **tamaño en ventana** para cuando el usuario la restaure: 85 % del área útil del monitor principal,
   como mínimo 960 × 640 y como máximo 1600 × 1000 lógicos, centrada.
2. Se aplica ese tamaño y **se maximiza** antes de `show()` (sin destello de la ventana pequeña).

### Arranques siguientes

- `openMode = "last"` (por defecto): vuelve como se dejó (maximizada, en ventana con su tamaño y posición, o en
  pantalla completa si `rememberFullscreen`).
- `openMode = "maximized"`: siempre maximizada; el tamaño en ventana guardado se usa al restaurar.
- `openMode = "fullscreen"`: siempre en pantalla completa.

### Al restaurar el tamaño guardado

- Se guarda en **lógicos** (`width`, `height`, `x`, `y`) junto al monitor (`monitor`: nombre o posición) y se
  aplica en lógicos, para que un cambio de escala no la agrande o encoja.
- Se **recorta al área útil** del monitor donde cae: si es más grande, se reduce; si queda fuera, se centra en el
  monitor principal. El mínimo de la ventana siempre manda.
- Lectura de valores antiguos (físicos, sin `monitor`): se convierten con la escala del monitor donde caen.

### Migración de usuarios actuales

- Si el tamaño guardado es exactamente el antiguo por defecto (1480 × 940 lógicos, ±2 px) y no está maximizada, se
  trata como primer arranque una vez: abre maximizada. Quien cambió el tamaño a mano lo conserva.

### Pantalla completa

- F11 alterna, desde cualquier vista y con el foco dentro de una herramienta (por el mismo camino que Ctrl+J).
- Al salir vuelve al estado anterior (maximizada o en ventana con su tamaño).
- Esc no sale (Esc ya cierra menús y selecciones en las herramientas).
- Es distinta de la pantalla completa del visor que ya tienen Grade, Frame Capture, Upscale, AI Interpolate y
  Visualizer (`requestFullscreen` de un elemento): esa sigue igual y Esc la cierra como hoy. Si la ventana está en
  pantalla completa y el visor también, salir del visor deja la ventana en pantalla completa.
- La primera vez que se entra, un toast `window.fullscreenHint` ("Press F11 to leave full screen") durante unos
  segundos.

---

## 4. Tamaño mínimo

- Se mantiene **960 × 640 lógicos**: cabe en el área útil más pequeña habitual (1280 × 680 aprox.) con margen para
  dejar dos ventanas a media pantalla en 1920 de ancho.
- Antes de implementar, una pasada de auditoría: cada herramienta y Home, Library y Settings a 960 × 640, 1280 × 720,
  1920 × 1080 y 2560 × 1440, buscando solapes, scroll horizontal y controles cortados. Lo que falle se arregla en su
  `<tool>.css` dentro de la misma tarea; si alguna herramienta no puede plegarse a 960 de ancho, se documenta aquí y se
  decide entre subir el mínimo o arreglarla.
- Con el dock abierto en modo `pinned` (`DOCK_SPEC.md`) el área de contenido es más estrecha; por debajo de 1280 px
  ese modo pasa a superponerse, así que el mínimo no cambia por el dock.

---

## 5. Parámetros

`app.json` → `window` (Rust, `window.rs`):

| Clave | Tipo | Qué es |
|---|---|---|
| `width`, `height` | lógicos | tamaño en ventana |
| `x`, `y` | lógicos | posición exterior en ventana |
| `monitor` | texto | monitor donde estaba |
| `maximized` | bool | estado al cerrar |
| `fullscreen` | bool | estado al cerrar |

Ajustes (`DEFAULT_SETTINGS`, sección `interface`):

| Clave | Por defecto | Valores |
|---|---|---|
| `openMode` | `"last"` | `last` · `maximized` · `fullscreen` |
| `rememberFullscreen` | `false` | con `last`, si cerrar en pantalla completa abre en pantalla completa |

Constantes (Rust): `FIRST_RUN_FRACTION = 0.85`, `FIRST_RUN_MAX = 1600 × 1000`, `MIN = 960 × 640` (este último sigue
en `tauri.conf.json`).

En Settings → Interface: selector "Open the window" con *As I left it*, *Maximized*, *Full screen*.

Textos nuevos solo en `en.json`: `set.openMode`, `set.openMode.last`, `set.openMode.maximized`,
`set.openMode.fullscreen`, `window.fullscreenHint`, `keys.fullscreen`.

---

## 6. Código

- `app/src-tauri/src/window.rs` → sección `window size and position`: `restore_window` (primer arranque, modos,
  recorte al área útil, migración), `save_window` (lógicos, monitor, pantalla completa); comando nuevo
  `window_fullscreen(on)` registrado en `main.rs`.
- `tauri.conf.json`: sin cambios de mínimo; el `width`/`height` de la ventana queda como respaldo si
  `restore_window` falla.
- `shell.js`: F11 en `globalKeys`, el toast, el selector en `renderSettings`, hoja de atajos.
- `docs/ARCHITECTURE.md`: `window.rs` en el mapa.

---

## 7. Pruebas

- `cargo test` en `window.rs`: cálculo del tamaño de primer arranque para áreas de 1280 × 680, 1366 × 728, 1920 ×
  1040 y 2560 × 1400; recorte de un tamaño guardado mayor que el monitor; posición fuera de todo monitor → centrada;
  conversión de valores antiguos en físicos; migración del 1480 × 940.
- Playwright (`host.js`): F11 llama a `window_fullscreen`; el selector guarda `openMode`.
- `npm run test:real` una vez (es Rust): primer arranque maximizado, cerrar en ventana y volver igual.
- En Windows (Java): portátil al 125–150 %, segundo monitor con otra escala, desconectar el monitor donde estaba.

---

## 8. Criterios de aceptación

1. Una instalación nueva abre maximizada, sin destello de una ventana más pequeña.
2. Restaurar desde maximizada da una ventana del 85 % del área útil, centrada, nunca mayor que la pantalla.
3. Cerrar en ventana y volver a abrir conserva tamaño y posición, también tras cambiar la escala de Windows.
4. Ninguna combinación de monitor, escala o resolución abre la ventana más grande que el área útil o fuera de
   pantalla.
5. F11 entra y sale de pantalla completa desde cualquier vista; al salir vuelve al estado anterior.
6. Usuarios que actualizan con el tamaño antiguo por defecto abren maximizada una vez; los que lo cambiaron, no.
7. Todas las vistas son usables a 960 × 640 (auditoría de §4 hecha).

---

## 9. Fuera de alcance

- Barra de título propia (sin la nativa de Windows).
- Varias ventanas o sacar una herramienta a una ventana aparte.
- Distribuciones por herramienta (tamaños de paneles guardados) o escalado de la interfaz (zoom).
- Recordar tamaño distinto por herramienta.

---

## 10. Implementación (1.2.0)

- `app.json` → `window`: `x`, `y` siguen en **píxeles físicos** (identifican el monitor sin ambigüedad entre escalas);
  `width`, `height` en lógicos con `units: 2`; además `monitor`, `maximized`, `fullscreen`. Un archivo sin `units` se
  lee como antes (físicos) y se convierte con la escala del monitor donde cae.
- Los ajustes son planos en `settings`: `openMode` y `rememberFullscreen` (sin control en Settings; `false`).
  `fullscreenHinted` recuerda que el aviso de F11 ya se mostró.
- La decisión es una función pura, `window.rs` → `plan`, con sus pruebas en `cargo test`; `restore_window` la aplica
  (posición, tamaño, y luego maximizar o pantalla completa) antes de `show()`.
- En el primer arranque se usa el monitor donde estaba la ventana si había posición guardada (migración desde el
  tamaño antiguo); si no, el principal.
- `tests/realapp.py` comprueba el primer arranque (en Xvfb no hay gestor de ventanas que maximice, así que se ve el
  85 %: 1600 × 918 en 1920 × 1080) y que el tamaño guardado vuelve.
- Pendiente de verificar en Windows: maximizar real, escalas 125–150 %, segundo monitor (§7).
