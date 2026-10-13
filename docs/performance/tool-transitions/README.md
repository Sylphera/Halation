# Transiciones de Halation: medición y validación

Base: `task/ui-performance`, `11a640ab1ecaffa4a1b20091632cf6c4998b12e8`. El usuario aprobó explícitamente las transiciones, springs y sombras de la instancia nativa. Los dos fallos preexistentes del runner general de motion se conservan documentados, sin relajar sus asserts.

## Método

WebView2 nativo del portable 1.0.1, en la misma máquina y perfil de pruebas. Se sirven los JS del commit base o del workspace mediante rutas CDP externas; no se ha empaquetado un ejecutable nuevo. HTML/CSS no cambiaron entre la release base y 11a640a. Se abren Grade, Background Remover, AI Interpolate, Frame Capture y Upscale una vez y se reutilizan sus mismas instancias durante tres vueltas. Los casos no ejecutan procesamiento de media: aíslan la navegación de interfaces ya cargadas. Las pruebas de media/Sessions anteriores son funcionales y separadas.

La ventana nominal comparable es de 300 ms desde show(). También se conserva la duración real hasta el final de las dos fases, callbacks rAF, gaps y long tasks en `actual`. Cada caso espera 1000 ms más un margen antes del siguiente. rAF es un callback, no una garantía de frames presentados. Skeleton/contenido son elegibilidad visible observada mediante estilos en rAF, no una captura de píxeles. Ready significa API lista y adapter registrado, no modelos de procesamiento inicializados. Los tiempos de animaciones son callbacks de GSAP y están en los JSON.

El after protegido comprueba destino, una sola navegación, cero inicializaciones y la identidad de todas las tools. Se descartó íntegramente una serie con una navegación externa a Title Intro; no se incluyen sus resultados. No se generaron screenshots, vídeos ni comparaciones visuales automatizadas.

## Causa warm

La transición cambia transform/opacity del iframe. Las sombras que escapan de él se montan en la shell y perdían su firma de geometría cada frame: nueva rasterización WebGL, redimensionado del scratch canvas y copia GPU→2D. Esto persistía sin inicializar ninguna tool. En Grade ↔ Background Remover había aproximadamente 120–140 rasterizaciones por transición y gaps repetidos de 42 ms. Suspender sólo los recálculos de los iframes redujo el gap a unos 14 ms, manteniendo springs y shell.

No existe un reveal completo independiente de entrada/salida en estas tools durante una navegación warm estable. El reveal de iframe de 320 ms pertenece al skeleton cold. En la base podía cancelar la cola de la transición principal porque ambos usan el canal vis. Home sí ejecuta sus propios springs: logo/word/note/hcards, a partir de 40/68/96/124 ms y hasta unos 360–450 ms; solapaban la transición global.

## Warm: tres vueltas, rango de todas las muestras

Cada celda before/after muestra callbacks en 300 ms / gap máximo en ms. No se selecciona sólo la vuelta más favorable.

| Recorrido | Before: rAF / gap | After: rAF / gap | Rasterizaciones |
|---|---:|---:|---:|
| home → grade | 11.0–14.0 / 41.6–41.6 | 39.0–40.0 / 20.7–20.9 | 74.0–79.0 → 6.0 |
| grade → home | 14.0–15.0 / 41.7–41.8 | 39.0 / 20.7–20.8 | 69.0–71.0 → 6.0 |
| home → removebg | 17.0–18.0 / 27.8–34.7 | 40.0 / 13.9–20.8 | 112.0–115.0 → 6.0 |
| removebg → home | 18.0 / 34.7–34.7 | 39.0–41.0 / 14.0–20.8 | 100.0–101.0 → 6.0 |
| home → interp | 20.0–22.0 / 27.7–27.8 | 36.0–40.0 / 20.7–41.9 | 81.0–84.0 → 6.0 |
| interp → home | 19.0–22.0 / 27.8–41.5 | 39.0–40.0 / 20.7–20.9 | 68.0–75.0 → 6.0 |
| home → framegrab | 21.0–25.0 / 20.9–34.6 | 40.0–41.0 / 14.0–20.8 | 67.0–75.0 → 6.0 |
| framegrab → home | 21.0–24.0 / 20.9–27.8 | 40.0–41.0 / 14.0–20.9 | 65.0–70.0 → 6.0 |
| home → upscale | 19.0–21.0 / 27.7–27.8 | 40.0 / 20.8 | 69.0–74.0 → 6.0 |
| upscale → home | 19.0–22.0 / 27.8–27.8 | 40.0–41.0 / 13.9–20.8 | 65.0–70.0 → 6.0 |
| grade → removebg | 13.0–14.0 / 41.7–41.8 | 42.0–43.0 / 13.9 | 107.0–137.0 → 0.0 |
| removebg → grade | 11.0–12.0 / 41.7–41.8 | 42.0 / 14.0 | 120.0–131.0 → 0.0 |

Long tasks nativos dentro de la transición: 0 before, 0 after. Esto no sustituye el frame pacing: la base tenía stutter aun sin tasks >50 ms. Se conserva el outlier after de 41,9 ms de Home → AI Interpolate, sin inicialización. Su causa no está atribuida. No se reprodujo un pico de 160–220 ms en estos casos controlados.

## Cold: Home → tool

Los tiempos son ms desde show(). El coste de quedar lista aumenta al desplazar la inicialización fuera de la transición: es el intercambio deliberado por una entrada fluida.

| Tool | Gap before → after | rAF before → after | Init | Skeleton visible | Contenido visible | API ready |
|---|---:|---:|---:|---:|---:|---:|
| grade | 76.4 → 48.8 | 11 → 36 | 168.3 → 451.5 | 101.5 → 91.5 | 344.8 → 590.2 | 344.3 → 561.2 |
| removebg | 48.6 → 20.8 | 13 → 40 | 69.7 → 347.2 | 78.4 → 84.3 | 174.5 → 397.2 | 174.1 → 358.4 |
| interp | 41.6 → 20.8 | 15 → 40 | 67.7 → 343.0 | 112.0 → 87.1 | 205.0 → 425.5 | 204.6 → 401.5 |
| framegrab | 34.7 → 13.9 | 15 → 40 | 123.5 → 356.7 | 109.5 → 88.2 | 200.6 → 419.3 | 200.2 → 399.9 |
| upscale | 34.7 → 20.9 | 16 → 41 | 72.1 → 346.4 | 90.5 → 84.6 | 153.2 → 410.8 | 152.7 → 389.2 |

## A/B de springs y composición

La siguiente tabla agrupa las seis muestras warm Grade ↔ Background Remover de cada experimento. Los bypass son únicamente rutas del harness externo. `no-spring` elimina temporalmente springs internos/Home/reveal, preservando la animación global; `sequence` los prepara y pausa hasta settled; `shell-exit` pausa tweens de la tool saliente durante la salida. Sin tweens internos warm de navegación, shell-exit no aporta mejora causal. Cold y sus timelines se conservan cuando la versión del harness ya los registraba.

| Experimento | rAF / 300 ms | Gap ms |
|---|---:|---:|
| normal (11a640a) | 12.0–14.0 | 34.8–41.7 |
| no-spring (11a640a) | 12.0–15.0 | 41.7–41.8 |
| sequence (11a640a) | 12.0–15.0 | 34.8–41.7 |
| shell-exit (11a640a) | 12.0–14.0 | 34.8–41.8 |
| freeze-child (11a640a) | 40.0–43.0 | 13.9–14.2 |
| freeze-root (11a640a) | 13.0–16.0 | 34.7–41.7 |
| sequence (prototipo) | 42.0–43.0 | 13.7–14.0 |
| no-spring (prototipo) | 40.0–42.0 | 13.8–21.8 |

Desactivar o secuenciar springs no corrige por sí solo el coste warm original. Después de reutilizar sombras, secuenciar los springs de Home reduce sus rasterizaciones durante la transición principal; se conserva el spring con su delay, easing y duración, después de la shell.

Las estrategias de carga inmediata, doble rAF, 60 ms y 220/300 ms se midieron antes del bloque warm. Un pequeño defer seguía metiendo inicialización dentro de la animación. La implementación espera la finalización real de ambas fases, no un timeout fijo de 300 ms. Esto resuelve cold; la mejora warm procede del renderer.

## Cambios

- `motion.js`: promesa settled de ambas fases, más gate opcional para preparar un reveal sin reproducirlo hasta que termine su dueño visual. Cancelar restaura también un reveal pendiente. Física y tokens iguales; reduced/off conservan su comportamiento.
- `shell.js`: skeleton inmediato; src/ensureApp/preload y reveal cold respetan la transición actual y las interrupciones. Home conserva sus springs después de settled.
- `ui-shadows.js`: invalidación acotada y reutilización de planos escapados durante transform/opacity de vistas. Transformación y fade por composición; cambios de tamaño, fuentes de sombra, visibilidad de contenido, matrices no soportadas o márgenes insuficientes conservan el camino de rasterización. Margen de 32 CSS px, cache por el record existente; sin cache ilimitada. Shader/falloff/dither/colores intactos. No es el arreglo de banding.
- `upscale.js`: un único repintado idempotente del icono Play. onAway reconstruía el SVG incluso ya parado e invalidaba las sombras durante la salida. No cambia procesamiento, calidad, reproducción ni etiqueta localizada.
- Tests de transición, interrupción, Home gate, geometría/opacity/ocultación de sombras y estabilidad del icono Play; runners externos para reproducir la medición.

No se han eliminado springs, efectos estéticos ni features. No se rediseñan Sessions ni tools. La integración y publicación posteriores fueron autorizadas explícitamente por el usuario.

## Validación

`tool-transitions` y `ui-shadow-transitions` pasan, incluidos gate de Home, interrupciones de ambas fases, carga oculta explícita, preload listo a media transición, reduced/off, planos locales/escapados, cambio de tamaño y superficie oculta. Sintaxis y diff-check pasan. Sessions runtime/system/media, Jobs y localization pasaron en esta rama antes del último bloque de composición; se registrarán abajo las repeticiones finales realizadas.

Batería final de cierre: sintaxis de todos los JS del frontend, `tool-transitions`, `ui-shadow-transitions`, `sessions-runtime`, `sessions-system`, `sessions-media`, `sessions-autosave`, `jobs`, `localization`, `removebg --functional`, `grade-runtime`, `upscale --functional` y `scan --localization` pasan. Los tests focales cubren el gate de Home y su cancelación, y el icono Play idempotente de Upscale. Sessions-system comprueba Save/Save As/Open, clean close/restart, recovery tras terminación inesperada, Discard y advertencia/cancelación de cierre, sin Session permanente automática. Autosave comprueba que cambios durante la escritura siguen dejando dirty. Upscale conserva tamaño y fidelidad de salida, limpieza de cola y envío a Grade.

La primera ejecución concurrente de scan perdió su página de Chromium. Upscale quedó esperando un resultado con su Chromium ya cerrado; ambos recorridos se repitieron aislados y pasaron sin cambiar código ni asserts. No se establece una causa del cierre del navegador a partir de esas observaciones. El cierre normal del navegador del runner diagnóstico de Upscale produjo además mensajes en stderr que PowerShell trató como error; la repetición con captura directa del exit de Node confirmó código 0. No se generaron screenshots.

Después del fast-forward se repitió la batería sobre main: sintaxis, sombras, Sessions runtime/system/media/autosave, Jobs, localization, Background Remover, Grade, Upscale y scan pasaron. El test nuevo de transiciones reveló carreras de muestreo con sus sleeps externos de 450/80 ms. Se sincronizó la finalización warm con settled y se observó readiness/skeleton en el mismo turno del navegador, antes de otro render; se conservan los asserts y se añaden checks de ready y transición aún pendiente. El runtime aprobado no cambia. La repetición focal pasa. Un control negativo externo que omite sólo el gate de llegada de Interpolate hace fallar el assert del skeleton, confirmando que el test sigue detectando un reveal prematuro.

El runner general `motion --functional` conserva los asserts de long tasks y menú después de 7 clicks rápidos. Las repeticiones contra el frontend base y el workspace final fallan esos mismos dos checks. El runner fuerza ANGLE/SwiftShader y el trace completo incluye los recorridos de Library/Settings/menús/otras tools; no es la medición nativa aislada de las transiciones. No se han desactivado ni relajado asserts ni se atribuye todo ese fallo al entorno: el estado parcial del menú queda pendiente de diagnóstico separado. La ejecución final coincidió parcialmente con otros tests funcionales, por lo que sus números de frame pacing no se usan como comparación before/after. El fallo de ambos checks ya se había reproducido por separado. No se ejecutó la suite completa ni checks Rust porque no se tocó backend.

La revisión manual se realizó en la instancia nativa con el frontend del workspace y Sessions activos, sin probes ni bypass. El usuario confirmó que transiciones, springs y sombras se ven correctos y mucho más fluidos, y autorizó cerrar el bloque. Los JSON y las mediciones complementan esa aprobación, sin reemplazarla. No se persiguen nuevos outliers ni se incluye el banding nativo al superponer ventanas.

## Reproducción

Con un portable desechable habilitado para remote debugging en localhost:9237 y Playwright disponible en .tools:

`node app/scripts/tool-choreography-benchmark.cjs normal before --allow-reset`

`HAL_WARM_REVISION=working` selecciona el workspace; por defecto usa 11a640a. En PowerShell se configura mediante `$env:HAL_WARM_REVISION='working'`. Los modos temporales figuran en la tabla anterior; sus resultados se escriben en .tools. No usar en una instancia con trabajo del usuario. El harness recarga su ventana, pero no publica artefactos ni introduce instrumentación en app/dist.
