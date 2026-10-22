# Movimiento nativo (Slint)

Status: Planned — spec pendiente del visto bueno de Java; hoy solo animan colores, el knob del switch y el ancho de la
sidebar (160 ms, `ease-out`).

Qué se mueve en la app Slint, cómo y con qué valores. Los principios siguen siendo los de [MOTION.md](../MOTION.md)
(un muelle críticamente amortiguado, la primera imagen responde, interrumpible con la velocidad heredada, nada aparece de
la nada, sin pantallas de carga); su mecánica web (GSAP, Flip, CSS) es solo de Tauri. Esta spec sustituye, para el
movimiento, a la sección *Motion* de [SLINT_SPEC.md](../SLINT_SPEC.md) («navegación inmediata, 160 ms, sin muelle»).

La app Tauri (`main`) es la referencia de comportamiento: duraciones, curvas y escalonados se han medido leyendo su
código; la implementación es propia (regla clean-room de [AGENTS.md](../../AGENTS.md)).

## 1. Inventario: original frente a Slint hoy

| Momento | Original (Tauri) | Slint hoy |
|---|---|---|
| Arranque | Sidebar entra desde −18 px con fade (300 ms); iconos uno tras otro (28 ms, desde −8 px y 0.9); el contenido avanza (0.97 → 1, blur 8 → 0) | Instantáneo |
| Entrada de Home | Marca, wordmark, frase y barra de herramientas suben 8 px y aparecen escalonadas (28 ms, +40 ms); la marca además 0.96 → 1 | Instantáneo |
| Cambio de página | La página nueva crece desde su icono (0.72 → 1) mientras la vieja retrocede (0.96, blur, fade); 300 ms | Instantáneo |
| Abrir/cerrar la sidebar | La superficie cambia de forma en el muelle (320 ms); las filas se deslizan; los nombres entran escalonados desde −8 px; el contenido se desplaza | Ancho 256 ms `ease-out`; nombres y logo saltan |
| Selección en la sidebar | Una sola píldora que se desliza a la pestaña elegida, heredando velocidad | El fondo cambia en el sitio, sin animar |
| Hover en la sidebar | Una píldora compartida que se desliza entre filas | El fondo aparece/desaparece de golpe |
| Tooltips | Aparecen tras 120 ms con fade y 4 px de desplazamiento (320 ms) | Aparecen y desaparecen de golpe |
| Pulsar un botón | Se hunde a 0.97 en 60 ms; vuelve en el muelle | Solo cambia el color (0 ms al pulsar, 160 ms al soltar) |
| Switch | Knob en el muelle (320 ms) | Knob 160 ms `ease-out` |
| Menús (Select) | Crecen desde el botón (0.96 → 1, fade); opciones escalonadas 4 px (≈17 ms) | Instantáneo |
| Categorías de Settings | El panel nuevo entra con fade y una pequeña subida | Instantáneo |
| Avisos (notice, error) | Entran con fade y subida corta; salen con fade (140 ms) | Instantáneo |
| Zona de soltar | Se inclina hacia el puntero al arrastrar (1.006–1.012) y cede al soltar | Solo color |
| Movimiento reducido | Todo pasa a un fade de 140 ms | Duración 0 |

## 2. Base técnica

Slint 1.18 trae lo que hace falta sin motor propio:

- `easing: spring(0)`: muelle críticamente amortiguado (sin rebote). Su `duration` fija la frecuencia natural
  (ω = 2π / duración), no el tiempo de asentamiento.
- Un muelle interrumpido arranca hacia el nuevo destino con la velocidad que llevaba (retarget nativo): la regla 4 de
  MOTION.md sale gratis.
- `transform-scale`, `transform-origin` y `opacity` en cualquier elemento; `animate … { delay }`; `states` con
  transiciones `in`/`out` distintas.

Límites de Slint que fijan el diseño:

- No hay `blur` sobre elementos: la profundidad se expresa solo con escala y opacidad.
- Un elemento de `if` desaparece al instante: no hay animación de salida salvo mantenerlo vivo (coste). Por eso la
  página vieja no anima su salida (ver §6).
- `opacity` sobre un contenedor lo pinta en una capa aparte mientras es < 1: solo se usa durante la transición.

## 3. Tokens

Un global `Motion` (Slint) cuyos valores calcula Rust (`motion.rs`) desde Settings; con movimiento reducido todas las
duraciones son 0 y las escalas 100 %.

| Token | Valor | Equivale en el original | Uso |
|---|---|---|---|
| `spring` | 218 ms (`spring(0)`) | `--spring` 320 ms: asentado en 320 ms | La interfaz: píldoras, sidebar, knob, menús, tooltips, soltar un botón |
| `place` | 204 ms (`spring(0)`) | `--place` 300 ms | Cambio de lugar: entrada de página, arranque |
| `fade` | 140 ms (`ease-out`) | `--fade` | Lo que solo se desvanece: salidas de tooltips, avisos |
| `stagger` | 28 ms | `--stagger` | Entre elementos de un grupo que llegan juntos (máx. 12) |
| `press` | 60 ms (`ease-out`) | press 60 ms | Hundir al pulsar |
| `press-scale` | 97 % | `--press-scale` 0.97 | Escala al pulsar |
| `tip-delay` | 120 ms | delay del tooltip | Espera antes de mostrar un tooltip |

Conversión: el original llega al 99.9 % en T con ω·T = 9.23; Slint usa ω = 2π / d, así que d = 2π·T / 9.23 ≈ 0.68·T.
Con eso, 218 ms en Slint se siente igual que los 320 ms del original. Los colores siguen cambiando con `fade`.

## 4. Qué se mueve (valores por defecto)

Movimiento normal; con movimiento reducido, todo llega a su estado final al instante.

1. **Arranque** (una vez, al mostrar la ventana): la sidebar entra desde x −18 px con opacidad 0 → 1 (`place`); sus
   iconos, desde −8 px y 90 %, escalonados (`stagger`, empiezan a 60 ms); la hoja de contenido 97 % → 100 % con
   opacidad (`place`, 40 ms de retraso). Sin blur.
2. **Entrada de Home** (al arrancar y al volver a Home): marca (96 % → 100 %), wordmark, frase, barra de herramientas y
   zona de soltar suben 8 px con fade, escalonados 28 ms a partir de 40 ms (`spring`).
3. **Cambio de página** (Home ↔ Settings, y las herramientas cuando existan): la página nueva aparece con opacidad
   0 → 1 y escala 98.5 % → 100 % desde su centro (`place`). La vieja se quita en el primer frame (§6). El título de la
   barra superior cambia con un fade cruzado corto (`fade`).
4. **Sidebar abrir/cerrar**: el ancho en el muelle (`spring`, no 1.6× ease-out); el logo se desliza a su sitio; los
   nombres y títulos de grupo entran desde −8 px con fade, escalonados (`stagger`) al abrir, y se van con `fade` al
   cerrar. La página se desplaza con el ancho (como hoy).
5. **Píldora de selección**: un único rectángulo en la sidebar que se desliza (`y`, `spring`) a la fila activa; al
   cambiar rápido de página hereda la velocidad. Reemplaza el fondo por fila.
6. **Hover de la sidebar**: una píldora de hover compartida que se desliza a la fila bajo el puntero (`spring`) y aparece
   o se va con `fade`. Sin la fusión «metaball» con la píldora activa del original.
7. **Tooltips** (sidebar cerrada y barra superior): siempre presentes con opacidad 0; al hover o foco aparecen tras
   `tip-delay` con fade y 4 px de desplazamiento hacia su sitio (`spring`); se van sin espera (`fade`).
8. **Pulsación**: botones, filas de la sidebar, elementos de la barra de Home, botones de la barra superior y opciones
   de Settings bajan a `press-scale` en `press`; al soltar vuelven en el muelle. Las tarjetas grandes (zona de soltar)
   bajan solo a 99 %.
9. **Switch**: el knob en el muelle; el color con `fade`.
10. **Select**: el menú crece desde el botón (96 % → 100 %, fade, `spring`); las opciones entran 4 px escalonadas
    (≈17 ms, desde 20 ms). Se cierra al instante (PopupWindow no permite salida animada).
11. **Categorías de Settings**: el contenido nuevo entra con fade y 4 px de subida (`spring`); la píldora de la lista
    de categorías se desliza como la de la sidebar.
12. **Avisos**: el aviso de la barra superior y el error de Settings entran con fade y 4 px de subida (`spring`); al
    cerrar se van con `fade` (se mantienen vivos hasta acabar).
13. **Zona de soltar**: al arrastrar encima crece a 101 % (`spring`) y al soltar vuelve; el color como hoy.

## 5. Criterios de aceptación

1. Todas las animaciones toman sus valores del global `Motion`; ningún `.slint` lleva duraciones o curvas sueltas.
2. Con «Reduce animations» activo, cada transición de §4 llega a su estado final en el primer frame (test de estado en
   Rust/Slint: tokens a 0 y escalas a 100 %).
3. Ninguna animación en reposo: sin timers, sin `iteration-count` infinito; CPU/GPU en reposo en Home no sube respecto
   a la build actual (medido igual que en `planning/active/ui-redesign.md`, criterio 8).
4. La navegación cambia de estado en el primer frame tras el clic; ninguna acción espera a una animación.
5. Clics rápidos (Home ↔ Settings, abrir/cerrar sidebar con Ctrl+B repetido) no encolan ni saltan: la píldora y la
   sidebar siguen desde donde están con su velocidad.
6. Durante una transición no se pierden frames de forma visible en KernelPanic (Skia GL); una transición que los pierda
   se simplifica.
7. `cargo fmt --check`, clippy `-D warnings` y `cargo test --workspace` en verde.
8. Visto bueno de Java en la ventana nativa (Preview en KernelPanic) antes del merge.

## 6. Fuera de alcance

- Blur de profundidad (Slint no lo tiene sobre elementos).
- Salida animada de la página vieja y crecer desde el icono de la sidebar (0.72 → 1): exigiría mantener dos páginas
  vivas y medir su origen; se puede añadir después si la entrada sola se queda corta.
- La fusión «metaball» entre la píldora de hover y la activa.
- Skeletons, barras de progreso, listas con Flip y acordeones: llegan con las herramientas, Jobs y Library.
- Welcome (no portado) y la superficie de Processes.
- Fade de 140 ms con movimiento reducido: AGENTS.md exige estado final inmediato.

## 7. Implementación (resumen)

- `motion.rs`: calcula los tokens (normal / reducido) y los publica en el global `Motion`; se recalculan al cambiar el
  ajuste.
- `ui/motion.slint`: el global `Motion`; los componentes lo leen en vez de recibir `motion-duration`.
- Entradas: un `property <bool> shown` que pasa a `true` en `init` con `animate` sobre opacidad/escala/y y `delay`
  según su índice. Píldoras: un solo `Rectangle` por lista con `animate y`.
- Orden: tokens y migración de lo existente → píldoras y pulsación → tooltips y Select → entradas (arranque, Home,
  página, Settings) → avisos y zona de soltar. Preview en KernelPanic al final.
