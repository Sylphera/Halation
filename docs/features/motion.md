# Movimiento nativo (Slint)

Status: Implemented — pendiente de revisión visual de Java en la ventana nativa. Spec aprobada por Java (2026-10-22).
Código: `motion.rs`, `ui/motion.slint`, `ui/components/{pills,tooltip}.slint`; tests en `tests/services.rs` (reglas de
coste, tokens) y `tests/ui_layout.rs` (píldoras con eventos de puntero, movimiento reducido).

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
4. Duraciones cortas, al ritmo del ratón (Java, 2026-10-22: «tan rápido como muevas el mouse»): nada por encima de
   120 ms salvo el asentamiento de un muelle.
5. Entrar rápido, salir suave: el estado nuevo se ve casi en el primer frame; lo que se va se desvanece.
6. `ease-out` en todo menos en lo que se reorienta a mitad de camino (píldoras, knob), que usa `spring(0)`: un muelle
   conserva la velocidad al cambiar de destino, mientras que `ease-out` arranca de nuevo desde parado. Al barrer el
   puntero por varias filas la píldora cambia de destino en cada fila; con `ease-out` se paraba y arrancaba en cada
   una, que se veía como saltos de frames (Java, 2026-10-22).
7. Movimiento reducido: todas las duraciones a 0 (estado final en el primer frame) y nada escala; la píldora de hover
   salta en vez de deslizarse. La espera del tooltip se mantiene: es una espera, no movimiento.
8. Nada anima en reposo: sin `iteration-count` infinito; la CPU/GPU en reposo no cambia.

## 3. Tokens

Un global `Motion` (`ui/motion.slint`) cuyos valores calcula Rust (`motion.rs`) desde Settings; con movimiento
reducido, todas las duraciones a 0 ms y `press-scale` a 100 %. La curva vive en un global aparte (`Curve.ease`) porque
Rust no puede contener un `easing`; `spring(0)` se escribe en cada sitio porque Slint solo lo acepta como literal.

| Token | Valor | Curva | Uso |
|---|---|---|---|
| `hover-in` | 40 ms | `ease-out` | Aparece el estado de hover |
| `hover-out` | 90 ms | `ease-out` | Se va el estado de hover |
| `press` | 0 ms | — | Al pulsar: color y escala al instante |
| `release` | 70 ms | `ease-out` | Al soltar, vuelve al hover |
| `glide` | 55 ms | `spring(0)` | Borde delantero de las píldoras, knob |
| `trail` | 110 ms | `spring(0)` | Borde trasero de las píldoras |
| `fade` | 80 ms | `ease-out` | Tooltips, etiquetas de la sidebar |
| `panel` | 120 ms | `ease-out` | Ancho de la sidebar |
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
| Barra de herramientas de Home | Píldora de hover compartida, horizontal (abajo); icono y nombre → `text` |
| `AppButton` (normal, quiet, primary) | Fondo a su tono de hover; primary aclara su relleno |
| `Select`, `Field`, `SearchField` | Borde `line-strong` → `line-strong` aclarado; fondo → `control-hover` |
| Opciones de un `Select` abierto | Fondo → `control-active` |
| Tarjetas de modo de guardado y celdas de Settings | Fondo → `control-hover` |
| Zona de soltar de Home | Fondo y borde como hoy, con `hover-in`/`hover-out` |
| `Toggle` | Pista un tono más clara |

**Píldora de hover compartida** (sidebar, lista de categorías y barra de herramientas de Home; Java, 2026-10-22: «la
píldora del dock se mueve sin que le des clic y se desplaza fluidamente»): un único `Rectangle` sin hijos por lista,
detrás de las filas, que sigue al puntero sin clic. En la barra de Home se desliza en `x`; todas sus herramientas
tienen el mismo ancho (Java, 2026-10-22), las etiquetas largas se recortan con elipsis si la ventana es estrecha. Al
entrar el puntero en la lista aparece en la fila (su color pasa de transparente a `control-hover` en
`hover-in`, sin deslizarse desde ningún sitio); al pasar a otra fila **se estira y se funde** en ella (Java,
2026-10-22: «que se junta estilo Apple»): la píldora se dibuja entre dos bordes; el borde que va delante se mueve en
`glide` y el de detrás en `trail`, así que se alarga hacia la fila nueva y se cierra sobre ella, una sola forma todo el
camino. Son dos propiedades animadas de un `Rectangle` sin hijos: mismo coste que deslizarla. **Su velocidad sigue a la del ratón** (Java, 2026-10-22): al entrar en una fila, la lista mira cuánto
tardó el puntero desde la anterior (`animation-tick()`, leído en el callback, no en un binding: no pide frames); si
cruza filas a menos de dos `glide` de distancia, `glide` y `trail` se acortan en proporción, hasta un 30 %. Despacio, la
velocidad es la normal. Es una cuenta por fila cruzada, sin coste por frame; al salir de la lista se desvanece en `hover-out`. Sobre la fila activa se
queda debajo de la píldora de selección. Mismo coste que un hover por fila (un rectángulo, nivel 1–2) y da continuidad
al recorrer la lista.

### 4.2 Pulsación

El anillo de foco (2 px de acento) solo se ve con foco de teclado (Tab); un clic da el foco sin anillo (Java,
2026-10-22: «no quiero tener eso azul alrededor»).

Al pulsar: el color de pulsado y `press-scale` (97 %, `transform-scale` desde el centro) en el mismo frame. Al soltar
vuelve en `release`. En botones, filas de la sidebar, botones de la barra superior, elementos de la barra de Home y
opciones de Settings. La zona de soltar baja solo a 99 %.

### 4.3 Selección

La fila activa de la sidebar y la categoría activa de Settings se marcan con una **píldora de selección** (un
`Rectangle` sin hijos por lista) que se estira hacia la nueva fila y se funde en ella como la de hover. En la sidebar
la acompaña una **barra de acento** de 3 px a su izquierda que se estira con ella; el icono de la fila activa se
pinta de acento (Java, 2026-10-22). La navegación cambia en el primer frame; la píldora
llega después.

**Control segmentado** (`Segmented`, componente nuevo; Java, 2026-10-22: en las herramientas y en Settings la píldora
hace lo mismo con clic): una fila de opciones dentro de una cápsula, con una píldora de selección que se desliza en `x`
a la opción pulsada estirándose entre sus dos bordes, así que pasa de un ancho a otro sin saltos. Las opciones sin seleccionar tienen hover de color. En
Settings sustituye a «Open the window» y a «Mode» (Processing); las tarjetas del modo de guardado siguen como tarjetas.
Las herramientas lo usarán para sus pestañas y filtros cuando se porten.

### 4.4 Tooltips

Siempre presentes con colores transparentes. Tras `tip-wait` de hover continuo (o al instante con foco de teclado)
sus colores pasan a opacos en `fade`; al salir vuelven a transparente en `fade`, sin espera. Si el puntero pasa de un
elemento con tooltip a otro antes de `tip-wait`, el segundo aparece sin espera (estado compartido `TooltipState`).

### 4.5 Sidebar abrir/cerrar

El ancho en `panel` (nivel 4: la página se recoloca en cada frame; es el único caso). Los nombres y los títulos de grupo
aparecen y se van con el alfa de su color en `fade`. El logo cambia de sitio al
instante. Cerrada, cada título de grupo deja paso a una línea separadora; abierta, solo se ven los
títulos (Java, 2026-10-22). Al abrir o cerrar no se mueve nada más que el borde (Java, 2026-10-22: «se mueven cosas
hacia arriba, desaparecen cosas»): las cabeceras de grupo miden 24 px en los dos estados, así que ninguna fila cambia
de altura; iconos y logo quedan centrados en la columna plegada en los dos estados; nombres, títulos y líneas tienen
ancho fijo, los recorta el borde que se mueve y solo cambia el alfa de su color, en `fade`, en los dos sentidos.

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
- Píldoras (`PillList`): dos `Rectangle` sin hijos por lista; cada fila informa de su posición (`absolute-position`) al
  cambiar su hover, al pasar a activa y al moverse por un cambio de layout (entonces la píldora se coloca sin
  deslizarse). Al dejar de haber fila con hover, la píldora espera 200 ms antes de darse por ida: cruzar el hueco
  entre grupos sigue deslizándose.
- `transform-scale` se aplica a un contenedor interior, no a la raíz del componente: Slint 1.18 informa la posición
  absoluta de los hijos de un `Transform` desplazada por su origen, y eso movía los nombres accesibles.
- Tooltips: `Timer` de un disparo y colores con alfa animado.
- Orden: tokens y migración de lo existente → hover → pulsación y selección → tooltips → sidebar y switch → medición de
  frames → Preview en KernelPanic.
