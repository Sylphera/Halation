# Dock expandible — Especificación v1

El dock de la izquierda (`.rail`, `shell.js` → `buildRail`) es hoy una burbuja fija de iconos. Esta especificación
añade un segundo estado, **abierto**: el mismo dock crece hacia la derecha y pasa a ser un panel con el nombre de cada
herramienta y su actividad (cola, progreso, terminado, error). Se abre y se cierra con un gesto. Idea de Java:
2026-10-14 (bocetos: dock cerrado como columna de iconos; dock abierto como panel con icono + nombre por fila).

Estado: aprobada (Java, 2026-10-14) e implementada en 1.2.0. Lo que cambió al implementar está en §10.

---

## 0. Principios

1. **Opcional.** El dock cerrado sigue siendo el de hoy, píxel a píxel. Quien no lo abre no nota nada.
2. **Un solo objeto.** El panel abierto es el mismo dock transformado, no un segundo panel ni un popover. Comparte
   fondo, borde y píldora de selección.
3. **El contenido no salta.** Abrir el dock no cambia el tamaño de la herramienta visible (los lienzos de Visualizer,
   Grade o Frame Capture no se redimensionan). Ver §2.
4. **La actividad viene de un solo sitio.** Todo lo que el dock muestra sale de `__hal.jobs` (jobs.js) y de su evento
   `jobs`, igual que el menú de procesos. El dock no guarda estado de trabajos propio.
5. **Mismo lenguaje de estado que el menú de procesos** (`PROCESS_MENU_SPEC.md`): una sola marca por herramienta
   (reloj = en cola, arco = en marcha, tick = terminado, alerta = error). Sin combinar barra, brillo y texto para
   decir lo mismo.

---

## 1. Distribución

### Cerrado (hoy)

- Columna de 84 px (`body` grid `84px minmax(0,1fr)`), burbuja centrada en vertical, iconos de 44 × 44 px, grupos
  separados por `rail-sep`, Settings abajo.
- **Nuevo:** un tirador para abrir (§3) y una marca de actividad mínima en el icono de cada herramienta con trabajo
  (§4). Nada más cambia.

### Abierto

```
┌────────────────────────────────┐
│ (logo)  Home                   │
│ ─────                          │
│ ⤓  Downloader          ◔ 42 %  │   ← arco + porcentaje: en marcha
│ ⇄  Converter           ◷ 3     │   ← reloj + número: en cola
│ ─────                          │
│ 🎤 Vocal Remover               │
│ ∿  Audio Visualizer    ✓       │   ← terminado sin ver
│ ─────                          │
│ ◐  Grade               ⚠       │   ← error
│ …                              │
│ ─────                          │
│ ⚙  Settings                    │
│                         ‹      │   ← tirador para cerrar
└────────────────────────────────┘
```

- Ancho abierto: **232 px** de burbuja (parámetro `dockOpenWidth`). Misma altura, mismo radio (26 px), mismos grupos
  y separadores, mismo orden (Ctrl+1… no cambia).
- Cada fila: icono (44 × 44, en el mismo sitio que cerrado), nombre (`tab.<id>`, una línea, sin cortar: si no cabe,
  elipsis con el nombre completo en `title`), y a la derecha la columna de estado (§4).
- La píldora de selección (`#railPill`, `placePill`) se estira a la fila completa.
- Fila de herramienta con trabajo: segunda línea opcional, en `--text-3`, con el título corto del job que manda
  (el de mayor prioridad en marcha) y "+N" si hay más. Solo con `dockDetail = true` (§5).
- Pie: el tirador (‹). Nada más; no hay buscador, ni ajustes rápidos, ni lista de archivos.

---

## 2. Comportamiento con el contenido

Dos modos (`dockMode`, §5):

- **`overlay` (por defecto).** El dock abierto flota sobre el borde izquierdo del contenido; la columna del grid
  sigue en 84 px. El contenido no se mueve ni se redimensiona. Clic fuera del dock, Esc, o elegir una herramienta lo
  cierra (`dockAutoClose = true`).
- **`pinned`.** El dock queda abierto y empuja el contenido: la columna del grid pasa a `dockOpenWidth + 32` px una
  sola vez (sin animar `width`); el contenido se desplaza con un FLIP de `transform` y la herramienta recibe un único
  `resize` al terminar el movimiento. Elegir herramienta no lo cierra. Pensado para ventanas anchas.
- Si la ventana es más estrecha que `dockPinMinWidth` (1280 px lógicos), `pinned` se comporta como `overlay` sin
  cambiar el ajuste guardado.

---

## 3. Abrir y cerrar

- **Tirador:** botón de 28 × 28 px en el pie del dock, debajo de Settings (› cerrado, ‹ abierto), con
  `aria-expanded` y `aria-controls`. Tooltip `dock.open` / `dock.close` con el atajo.
- **Atajo:** Ctrl+B (libre hoy). Se añade a la hoja de atajos (`keys.dock`). Debe llegar también con el foco dentro
  de una herramienta, por el mismo camino que Ctrl+J. Grade usa B suelta para ver el original (`grade.js`, keydown sin
  mirar `ctrlKey`): ese manejador pasa a ignorar Ctrl+B; Background Remover (`b` = pincel) igual.
- **Doble clic** en el fondo vacío del dock (no en un icono) alterna también.
- **Sin abrir al pasar el ratón.** Abrir por hover haría saltar el panel al ir a cualquier icono; queda fuera (§9).
- El estado (abierto/cerrado) se guarda en `app.json` y se restaura al arrancar; en `overlay` el arranque es siempre
  cerrado.

### Movimiento (`MOTION.md`)

- Abrir: el fondo del dock se transforma de la geometría cerrada a la abierta con `M.slideTo`/FLIP (`scaleX` +
  `translateX` del fondo, contenido sin escalar), token `--spring`. Los nombres y la columna de estado entran con
  `opacity` + `translateX(-8px)` en `--stagger`.
- Cerrar: lo inverso; los nombres salen con `--fade` antes de que el fondo vuelva.
- Interrumpible: abrir durante un cierre parte de la geometría actual con su velocidad (`carry`).
- Solo `transform` y `opacity`. Sin animar `width`, `left` ni sombras.
- Movimiento reducido: fundido corto (`--fade`) entre los dos estados, sin desplazamientos.
- Seguir las filas: la barra (`placePill`) y la superficie compartida (`sharedHover`) se recolocan en el ticker de
  GSAP, en el mismo tick que mueve las filas, hasta que terminan sus tweens (`followDock`), no con un plazo de reloj.
  Las posiciones salen del layout más el `transform` pintado (`railPos`, `moved`), nunca de `getBoundingClientRect`
  tomado antes de que GSAP mueva la píldora; si no, la superficie seleccionada viaja con el hover.
- La barra y las píldoras (`glide`) tienen un solo tween a la vez: se mata el anterior y se anima con `to` desde donde
  está pintada. Un `fromTo` sobrescrito antes de su primer frame quedaba sin arrancar y, al matarlo, devolvía la barra a
  una fila vieja.
- Un elemento lo mueve un solo canal: `M.animate` cancela otro canal que anime las mismas propiedades (entrada `vis`
  y `dock-row` sobre una fila), tomando los valores actuales como origen.

---

## 4. Actividad por herramienta

### Modelo

Derivado en `shell.js` (sección nueva `/* ===== dock activity ===== */`) a partir de `__hal.jobs.list()` en cada
evento `jobs`. Por herramienta (`job.tool`):

```js
{
  tool: "upscale",
  running: 1,          // jobs en marcha
  queued: 2,           // en cola o retenidos (queued | held)
  progress: 0.42,      // media ponderada por cost de los que corren con progreso conocido; null si ninguno lo da
  failed: 0,           // fallidos que el usuario no ha visto
  doneUnseen: 1,       // terminados desde la última vez que se abrió esa herramienta
  lead: "song.mp4"     // título corto del job que manda (para la segunda línea)
}
```

- Jobs con `tool = "settings"` (instalación de componentes) se cuentan en Settings.
- Una herramienta sin job pero con progreso propio (`window.__jobs.setToolProgress`) cuenta como `running` con ese
  progreso.
- `doneUnseen` y `failed` se ponen a 0 al mostrar esa herramienta (`show(tab)`).

### Marca (una sola, por prioridad)

| Prioridad | Estado | Abierto | Cerrado |
|---|---|---|---|
| 1 | `failed > 0` | alerta | punto `--danger` en la esquina del icono |
| 2 | `running > 0` | arco de progreso (o arco indeterminado) + % si se conoce | arco fino alrededor del icono |
| 3 | `queued > 0` | reloj + número | punto `--text-3` |
| 4 | `doneUnseen > 0` | tick | punto `--accent` |
| — | nada | vacío | nada |

- Clic en la marca abre el menú de procesos (Ctrl+J) filtrado a esa herramienta; clic en el resto de la fila abre la
  herramienta.
- El arco usa el progreso de `motion.js` (`bar`/`glide`), sin saltos; indeterminado = arco que gira lento, apagado con
  movimiento reducido (queda el arco estático).
- Colores solo de `tokens.css`. La paleta la define el rework de color en curso (`COLOR_REWORK_SPEC.md`); este spec
  solo nombra tokens.
- Lectores de pantalla: cada fila tiene `aria-label` con nombre + estado (`dock.state.running` "{name}, {pct} %
  done", etc.); los cambios de estado no se anuncian uno a uno (los anuncia ya el menú de procesos).

---

## 5. Parámetros

En `DEFAULT_SETTINGS` (`shell.js`), sección `interface`, con migración que añade los valores por defecto:

| Clave | Por defecto | Valores | Qué hace |
|---|---|---|---|
| `dockOpen` | `false` | bool | estado guardado (solo se restaura en `pinned`) |
| `dockMode` | `"overlay"` | `overlay` · `pinned` | §2 |
| `dockOpenWidth` | `232` | 200–280 px | ancho de la burbuja abierta (constante, no se expone en Settings) |
| `dockAutoClose` | `true` | bool | en `overlay`, elegir herramienta cierra el dock |
| `dockDetail` | `true` | bool | segunda línea con el job que manda |
| `dockActivity` | `true` | bool | marcas de actividad en el dock cerrado |
| `dockPinMinWidth` | `1280` | px lógicos | por debajo, `pinned` actúa como `overlay` (constante) |

En Settings → Interface: un selector "Dock" con *Compact* (no se abre nunca, sin tirador), *Expand over content*
(`overlay`) y *Keep open* (`pinned`), y el interruptor "Show activity on the dock" (`dockActivity`). Por defecto
*Expand over content*.

Textos nuevos solo en `en.json`: `dock.open`, `dock.close`, `dock.state.running`, `dock.state.queued`,
`dock.state.done`, `dock.state.failed`, `keys.dock`, `set.dock`, `set.dock.compact`, `set.dock.overlay`,
`set.dock.pinned`, `set.dockActivity`.

---

## 6. Código

- `shell.js`: `buildRail` genera también nombre y columna de estado por fila (ocultos cerrado); nueva sección
  `dock activity` (`dockModel`, `renderDockActivity`) y `toggleDock(open)`; `globalKeys` (Ctrl+B); `placePill` sabe
  del ancho abierto; `renderSettings` (selector e interruptor).
- `shell.css`: `.rail[data-open]`, filas, columna de estado, marcas cerradas; `body[data-dock="pinned"]` cambia la
  columna del grid.
- `index.html`: tirador.
- `locales/en.json`: claves de §5.
- `docs/ARCHITECTURE.md`: entrada del dock en el mapa de `shell.js`.
- Sin Rust.

---

## 7. Pruebas (Playwright, `host.js`)

- Ctrl+B y el tirador abren y cierran; `aria-expanded` cambia; Esc y clic fuera cierran en `overlay`.
- En `overlay` el `getBoundingClientRect()` de `.frame` no cambia al abrir; en `pinned` cambia una vez y la
  herramienta recibe un solo `resize`.
- Con jobs simulados en `host.js`: arco + % en Upscale, reloj + 2 en Converter, alerta en Grade; al mostrar Grade la
  alerta desaparece del dock (sigue en el menú de procesos).
- Módulo desactivado: su fila no aparece; Ctrl+1… sigue el orden.
- Movimiento reducido: solo fundido.
- Capturas en `$SHOTS`: cerrado sin actividad, cerrado con marcas, abierto en reposo, abierto con actividad, `pinned`
  a 1920 × 1080, a 1024 × 680 y en español (nombres más largos).

---

## 8. Criterios de aceptación

1. Con el dock cerrado y sin trabajos, la interfaz es idéntica a la actual (captura comparada).
2. Abrir y cerrar con tirador, Ctrl+B y doble clic, interrumpible a mitad sin saltos.
3. Cada herramienta con trabajo muestra una sola marca, la misma que el menú de procesos para ese estado.
4. En `overlay` ninguna herramienta se redimensiona al abrir el dock.
5. Los nombres caben en inglés y español a 232 px, o se cortan con elipsis y `title`.
6. Teclado: Tab recorre las filas en orden; Enter abre la herramienta; la marca es un botón aparte.
7. El estado y el modo se guardan y se restauran.

---

## 9. Fuera de alcance

- Abrir al pasar el ratón.
- Reordenar herramientas arrastrando, favoritos o grupos editables.
- Cancelar o pausar jobs desde el dock (eso es del menú de procesos).
- Dock en otro borde de la ventana o flotante.
- Miniaturas o lista de archivos recientes en el dock.

---

## 10. Implementación (1.2.0)

Diferencias con lo de arriba, decididas al implementar:

- **Ajustes planos**, como el resto de `DEFAULT_SETTINGS`: `dockMode` (`compact` · `overlay` · `pinned`, por
  defecto `overlay`), `dockOpen` (solo se usa con `pinned`) y `dockActivity`. `dockAutoClose` y `dockDetail` no son
  ajustes: en `overlay` elegir herramienta siempre cierra y la segunda línea siempre se muestra. El ancho (232 px) y
  el mínimo de `pinned` (1280 px) son constantes (`--dock-w` en `shell.css`, `DOCK_PIN_MIN` en `shell.js`).
- **Settings → Interface** es una sección nueva (General ya tenía cuatro controles, el máximo sin Advanced): Dock,
  "Show activity on the dock" y "Open the window" (`WINDOW_SPEC.md`). Elegir *Keep open* abre el dock.
- **Cerrado, la marca es siempre un punto** en la esquina del icono, con el color del estado (sin arco), para no
  tapar el icono a 44 px.
- **La marca no es un botón aparte** (un botón dentro de otro no es válido): con el dock abierto, un clic en ella abre
  el menú de procesos sin filtro; Ctrl+J sigue igual. La fila entera es el botón de la herramienta.
- **El progreso propio de una herramienta sin job** (`setToolProgress`) no lleva herramienta, así que no se cuenta;
  solo los jobs.
- **Cerrar en `overlay`**: además de Esc, clic fuera y elegir herramienta, se cierra cuando la ventana principal
  pierde el foco (un clic dentro de una herramienta, otra aplicación).
- **Ventanas bajas** (≤ 800 px de alto): las pestañas pasan a 34 px para que todas y el tirador quepan a 640 px; antes
  ya se salían por abajo en esa altura.
- La superficie del dock es `.rail-bg`, que cambia de forma con `transform` en `--spring` y mantiene las esquinas
  redondas mientras se estira; los nombres entran con `--stagger`. En `pinned` el contenido se desliza con un FLIP.
- Tras probarlo Java (2026-10-14): abierto ocupa toda la altura de la ventana (12 px de margen) con los iconos donde
  estaban; la luz sigue al puntero en las dos direcciones, como en la zona de Home (cerrado, solo vertical); un nombre
  de archivo largo acaba en puntos suspensivos sin pisar la marca. El estado abierto es `data-expanded` (antes
  `data-open`, que coincidía con los botones de carpetas de Settings y abría una carpeta a cada clic en el dock).
- Segunda vuelta (Java, 2026-10-14): abierto, la altura se usa: las filas crecen hasta 52 px y el sobrante se reparte
  entre ellas (Library y Settings al pie); las filas se deslizan en `--spring` al abrir y cerrar. El tirador pasa a
  ser la última fila del dock, tras una línea: cerrado, su icono en la columna de los iconos; abierto, con su nombre
  ("Close the dock") como las herramientas.
- Tercera vuelta (Java, 2026-10-14): desde 1280 px de ancho, abrir el dock deja sitio al contenido también en
  *Expand when needed* (antes *Expand over the content*), para que Home y las herramientas sigan centradas en lo que
  queda; por debajo se superpone. Las pestañas son cuadradas y encogen juntas de 44 a 34 px con la altura de la
  ventana (`--tab`), en lugar de aplastarse a 44 × 34 en ventanas bajas o con la escala de Windows alta.
- Prueba: `app/tests/dock.js` (en `verify.js`), capturas en `$SHOTS/dock`.
