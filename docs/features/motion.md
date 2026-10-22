# Movimiento nativo (Slint)

Status: Planned — spec v2 pendiente del visto bueno de Java. Hoy solo animan algunos colores, el knob del switch y el
ancho de la sidebar (160 ms, `ease-out`); los hovers de la sidebar y de la barra superior son instantáneos.

Qué se mueve en la app Slint, con qué valores y cuánto cuesta. Diseñada desde cero sobre lo que hace Slint 1.18 con Skia
(Java, 2026-10-22: no se toma como referencia el código anterior; se buscan las animaciones más baratas posibles; el
hover es lo más importante). Sustituye, para el movimiento, a la sección *Motion* de [SLINT_SPEC.md](../SLINT_SPEC.md);
[MOTION.md](../MOTION.md) queda como documento de la app Tauri.

## 1. Qué cuesta una animación en Slint + Skia

Comprobado en el código de Slint 1.18.1 (`i-slint-renderer-skia`, `i-slint-core`):

- **Cada frame animado repinta la ventana entera.** El renderer Skia sobre OpenGL no usa repintado parcial
  (`use_partial_rendering() = false`): mientras una animación está activa se pinta todo, incluidos el Drape y el grano
  de Home, a la frecuencia del monitor (60 Hz o más). El coste de una animación ≈ número de frames × un repintado
  completo. **La primera palanca es la duración**, no la propiedad.
- **Un `delay` también cuesta.** Durante la espera la animación ya pide frames (`current_tick()` marca animación
  activa): frames completos sin ningún cambio visible. Los escalonados (`stagger`) multiplican eso.
- **`opacity` sobre un contenedor abre una capa** (`save_layer_alpha`, un buffer intermedio del tamaño del elemento)
  cuando tiene más de un hijo o hijos con hijos. Sobre una hoja (un `Text`, una `Image`, un `Rectangle` sin hijos) solo
  multiplica el alfa: gratis.
- **`transform-scale` / `transform-rotation`** son una matriz en el canvas: sin capa ni relayout.
- **Animar `width`/`height` de algo con layout** recalcula el layout del subárbol en cada frame.
- **Un muelle (`spring`) dura más que su `duration`:** termina cuando se asienta (≈1.5 × duración con `spring(0)`).
  A cambio, interrumpido hereda la velocidad. Una curva `ease-out` acaba exactamente en su duración.

### Escala de coste (de menos a más)

| Nivel | Qué | Coste por animación |
|---|---|---|
| 0 | Cambio instantáneo | 1 frame |
| 1 | Color (fondo, borde, texto, tinte) · `x`/`y` de un elemento · `transform-scale` · `opacity` de una hoja | N repintados |
| 2 | Muelle en vez de `ease-out` | ≈1.5 × N repintados |
| 3 | `opacity` de un contenedor | N repintados + una capa por frame |
| 4 | Ancho/alto con layout | N repintados + relayout por frame |
| 5 | `delay`, escalonados | Frames vacíos añadidos |
| — | Blur, sombras animadas, animación continua | Prohibido |

## 2. Reglas

1. Solo niveles 0–2 por defecto. El nivel 4 solo en la sidebar (§4.5). Niveles 3 y 5 fuera.
2. Para desvanecer algo compuesto (un tooltip: fondo + texto) se anima el **alfa de sus colores**, no `opacity`.
3. Sin `delay` en `animate`. Una espera (tooltip) la hace un `Timer` de Slint de un solo disparo, que no pinta nada y
   solo existe mientras dura el hover.
4. Duraciones cortas: nada por encima de 180 ms salvo el asentamiento de un muelle.
5. Entrar rápido, salir suave: el estado nuevo se ve casi en el primer frame; lo que se va se desvanece.
6. `ease-out` en todo lo que no se interrumpe a menudo; `spring(0)` solo en lo que sigue al puntero o a clics rápidos
   (píldoras, knob), donde heredar la velocidad evita tirones.
7. Movimiento reducido: todas las duraciones a 0 (estado final en el primer frame); la píldora de hover salta en vez de
   deslizarse.
8. Nada anima en reposo: sin `iteration-count` infinito; la CPU/GPU en reposo no cambia.

## 3. Tokens

Un global `Motion` (`ui/motion.slint`) cuyos valores calcula Rust (`motion.rs`) desde Settings; con movimiento
reducido, todos a 0 ms.

| Token | Valor | Curva | Uso |
|---|---|---|---|
| `hover-in` | 70 ms | `ease-out` | Aparece el estado de hover |
| `hover-out` | 160 ms | `ease-out` | Se va el estado de hover |
| `press` | 0 ms | — | Al pulsar: color y escala al instante |
| `release` | 120 ms | `ease-out` | Al soltar, vuelve al hover |
| `glide` | 160 ms | `spring(0)` (se asienta en ≈235 ms) | Píldoras de hover y selección, knob |
| `fade` | 120 ms | `ease-out` | Tooltips, etiquetas de la sidebar |
| `panel` | 180 ms | `ease-out` | Ancho de la sidebar |
| `tip-wait` | 400 ms | `Timer` | Espera antes de mostrar un tooltip |
| `press-scale` | 97 % | — | Escala al pulsar |

`ease-out` = `cubic-bezier(0.2, 0, 0, 1)`: casi todo el cambio en el primer tercio, así que 70 ms se perciben como
respuesta inmediata.

## 4. Qué se mueve

### 4.1 Hover (lo principal)

Cada elemento interactivo tiene hover, con `hover-in` al entrar y `hover-out` al salir, solo en color (nivel 1).
Cambian juntos el fondo, el tinte del icono y el color del texto.

| Elemento | Hover |
|---|---|
| Filas de la sidebar | Píldora de hover compartida (abajo); icono y nombre de `muted` a `text` |
| Lista de categorías de Settings | La misma píldora compartida |
| Botones de la barra superior | Fondo `transparent` → `control-hover`; icono `muted` → `text` |
| Elementos de la barra de herramientas de Home | Fondo → `hover-fill`; icono y nombre → `text` |
| `AppButton` (normal, quiet, primary) | Fondo a su tono de hover; primary aclara su relleno |
| `Select`, `Field`, `SearchField` | Borde `line-strong` → `line-strong` aclarado; fondo → `control-hover` |
| Opciones de un `Select` abierto | Fondo → `control-active` |
| Tarjetas de modo de guardado y celdas de Settings | Fondo → `control-hover` |
| Zona de soltar de Home | Fondo y borde como hoy, con `hover-in`/`hover-out` |
| `Toggle` | Pista un tono más clara |

**Píldora de hover compartida** (sidebar y lista de categorías): un único `Rectangle` sin hijos por lista, detrás de las
filas. Al entrar el puntero en la lista aparece en la fila (su color pasa de transparente a `control-hover` en
`hover-in`, sin deslizarse desde ningún sitio); al pasar a otra fila se desliza en `y` con `glide`, heredando la
velocidad si el puntero sigue moviéndose; al salir de la lista se desvanece en `hover-out`. Sobre la fila activa se
queda debajo de la píldora de selección. Mismo coste que un hover por fila (un rectángulo, nivel 1–2) y da continuidad
al recorrer la lista.

### 4.2 Pulsación

Al pulsar: el color de pulsado y `press-scale` (97 %, `transform-scale` desde el centro) en el mismo frame. Al soltar
vuelve en `release`. En botones, filas de la sidebar, botones de la barra superior, elementos de la barra de Home y
opciones de Settings. La zona de soltar baja solo a 99 %.

### 4.3 Selección

La fila activa de la sidebar y la categoría activa de Settings se marcan con una **píldora de selección** (un
`Rectangle` sin hijos por lista) que se desliza en `y` con `glide` a la nueva fila. La navegación cambia en el primer
frame; la píldora llega después.

### 4.4 Tooltips

Siempre presentes con colores transparentes. Tras `tip-wait` de hover continuo (o al instante con foco de teclado)
sus colores pasan a opacos en `fade`; al salir vuelven a transparente en `fade`, sin espera. Si el puntero pasa
directamente de un elemento con tooltip a otro, el segundo aparece sin espera (el `Timer` solo cuenta desde fuera de la
barra o la sidebar).

### 4.5 Sidebar abrir/cerrar

El ancho en `panel` (nivel 4: la página se recoloca en cada frame; es el único caso). Los nombres y los títulos de grupo
aparecen con el alfa de su color en `fade` al abrir; al cerrar desaparecen al instante. El logo cambia de sitio al
instante.

### 4.6 Switch

El knob se desliza con `glide`; la pista cambia de color en `fade`.

### 4.7 Sin animación (instantáneo)

Cambio de página, arranque, entrada de Home, cambio de categoría de Settings, apertura del `Select`, avisos y errores.
Animarlos exigiría `opacity` de contenedor (nivel 3) o escalonados (nivel 5). Si con lo de arriba se siguen viendo
secos, la opción más barata para la página es un fade de 120 ms de la página nueva (una capa del tamaño de la página
durante ≈8 frames), que se probaría aparte.

## 5. Criterios de aceptación

1. Todas las animaciones leen el global `Motion`; ningún `.slint` lleva duraciones ni curvas sueltas.
2. Ningún `animate` usa `delay`; ninguna animación anima `opacity` de un contenedor; solo la sidebar anima un ancho
   (comprobado con un test que recorre los `.slint`).
3. Con «Reduce animations», cada transición llega a su estado final en el primer frame (test de estado: tokens a 0).
4. Ninguna animación en reposo; CPU/GPU en reposo en Home y Settings igual que la build actual.
5. Medición en KernelPanic con un contador de frames (`diag`): un hover completo (entrar + salir) no pasa de ≈15 frames
   a 60 Hz; recorrer la sidebar de arriba abajo no deja frames después de parar.
6. Clics rápidos y Ctrl+B repetido no encolan: la píldora y la sidebar siguen desde donde están.
7. `cargo fmt --check`, clippy `-D warnings` y `cargo test --workspace` en verde.
8. Visto bueno de Java en la ventana nativa (Preview en KernelPanic) antes del merge.

## 6. Fuera de alcance

- Transiciones de página, entradas escalonadas, arranque animado (§4.7).
- Blur, sombras animadas, animación continua.
- Skeletons, progreso, listas y acordeones: llegan con Jobs, Library y las herramientas, con estas mismas reglas.

## 7. Implementación (resumen)

- `motion.rs` calcula los tokens (normal / reducido) y los publica en el global `Motion`; se recalculan al cambiar el
  ajuste. `motion-duration` desaparece de los componentes.
- Píldoras: un `Rectangle` por lista con `animate y`; cada fila informa de su `has-hover` a la lista
  (`changed has-hover`).
- Tooltips: `Timer` de un disparo y colores con alfa animado.
- Orden: tokens y migración de lo existente → hover → pulsación y selección → tooltips → sidebar y switch → medición de
  frames → Preview en KernelPanic.
