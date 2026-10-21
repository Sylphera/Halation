# Motion Text — Especificación v2 (rework de Title Intro)

> Historical, not authoritative: superseded or finished by 2026-10-21.

Estado (Java, 2026-10-14): la herramienta Motion Text / Intro se eliminó de Halation; esta spec se conserva como
referencia para una idea futura. Nada de lo que describe está en el código.

Sustituye a `INTRO_SPEC.md` en todo lo que contradiga. Motion Text es una máquina de generar tipografía animada: el
producto es el texto animado; el vídeo, si lo hay, solo es contexto de previsualización o la base sobre la que se
quema el texto. Si algo no está aquí, se decide con la sección 0 y se anota en `DECISIONS.md`.

---

## 0. Principios

1. **Un clic, un preset de pago.** Un preset visual más uno de animación dan un resultado que parece un preset de 20 $ de After Effects, sin
   tocar nada más que el texto.
2. **Estilo ≠ movimiento.** Apariencia, Entrada y Salida son independientes y combinables. Entrada y salida también
   son independientes entre sí.
3. **El impacto sale de tres capas, en este orden:** tipografía y composición → luz (bisel, especular, glow) → efecto.
   Un material que solo es un filtro sobre texto plano no entra.
4. **El movimiento caro se nota por:** capas desfasadas, curvas con carácter (arranque brusco, asentamiento largo,
   pequeño exceso), movimiento secundario durante el mantener y luz que se mueve.
5. **Sin editor de vídeo.** Sin timeline, pistas, clips, composición ni edición de metraje. El contenido se adapta al
   texto solo: nada de colocar capas a mano en una composición rígida.
6. **Determinista.** El mismo proyecto y el mismo tiempo dan el mismo fotograma (se mantiene de la v1).

---

## 1. Workflow

Se mantiene el de Halation: **presets a la izquierda, preview en el centro, ajustes a la derecha**.

- Se entra con un preset visual y uno de animación ya aplicados y reproduciéndose en bucle: la pantalla nunca está
  vacía y el primer paso es escribir el texto.
- Los presets están separados en dos familias independientes: **visuales** (cómo se ve) y **de animación** (cómo
  entra, se mantiene y sale). Aplicar uno no toca el otro ni el texto.
- Todo tiene valores por defecto buenos: cualquier combinación de un preset visual y uno de animación sale bien sin
  tocar un parámetro.
- Se elimina la parte de "editor visual": lista de elementos, imágenes como elemento, arrastrar y ajustar sobre el
  lienzo, guías y snap, línea de tiempo con pistas y el panel Stack.

## 2. Distribución

```
┌──────────────────┬───────────────────────────────────────┬────────────────────┐
│ TEXTO            │                                       │ AJUSTES            │
│ [HALATION     ]  │                                       │ [Apariencia]       │
│ [subtítulo    ]  │           PREVIEW                     │ [Entrada][Salida]  │
│                  │   (ajedrez si es alfa)                │ [Propiedades]      │
│ PRESETS          │                                       │ [Efectos][Exportar]│
│ [Visual][Anim.]  │                                       │                    │
│ ▣ ▣  (miniaturas │                                       │ ▾ Material         │
│ ▣ ▣   animadas)  │                                       │ ▾ Luz              │
│ ▣ ▣              ├───────────────────────────────────────┤ ▾ Contornos        │
│ Mis presets      │ ▶ ⟲  00:01.20 / 00:03.50  ▦ ■ □ 🖼    │ ▾ Extrusión · Glow │
│ [Guardar]        │ ▕ in ▏      mantener      ▕ out ▏      │                    │
└──────────────────┴───────────────────────────────────────┴────────────────────┘
```

- **Izquierda:** arriba el texto (campo grande multilínea y subtítulo opcional), porque es lo primero que se toca.
  Debajo los presets con dos pestañas, **Visual** y **Animación**, en rejilla de miniaturas (las de animación se
  reproducen al pasar el ratón), más "Mis presets" y guardar.
- **Centro:** preview dominante. Debajo, el transporte (play, bucle, tiempo), el selector de contexto (ajedrez,
  oscuro, claro, imagen o vídeo propio) y **una sola barra** con los tramos entrada · mantener · salida y sus toggles
  on/off (los de la v1). No hay pistas ni elementos.
- **Derecha:** ajustes con pestañas planas, una por función: Apariencia · Entrada · Salida · Propiedades · Efectos ·
  Exportar.
  Lo básico arriba de cada pestaña; el resto en acordeones plegados.
- Todo usa `tokens.css` y `motion.js`; textos solo en `en.json`.

## 3. Las partes

### 3.1 Texto (izquierda, arriba)
- Título (multilínea) y subtítulo opcional (una línea, más pequeño, con su propio peso).
- Fuente (fontpicker de la v1), peso, mayúsculas / título / tal cual.
- El texto se ajusta solo al lienzo: si no cabe, baja el tamaño.

### 3.1b Presets (izquierda)
- **Visual:** material, luz, contornos, extrusión, glow, fuente sugerida y composición del subtítulo. Ver §5 y §7.
- **Animación:** entrada, mantener, salida, acentos y capas (línea, destello). Ver §6 y §7.
- Guardar crea un preset de la familia de la pestaña abierta.

### 3.2 Apariencia (derecha; solo cómo se ve)
- **Material:** Chrome · Gold · Halation · Gradient · Solid. Fuera Glass, Dither, ASCII e Inverse.
- **Luz:** ángulo, intensidad del especular, barrido (on/off, cada cuánto).
- **Contornos:** hasta 3, cada uno con ancho, color y separación.
- **Extrusión 3D:** profundidad, ángulo, color del lateral, luz del lateral.
- **Glow:** radio, color, intensidad.

### 3.3 Entrada · 3.4 Salida (solo movimiento; misma interfaz, independientes)
- Toggle on/off en la cabecera (el de las barras de la v1): apagada no ocupa tiempo.
- **Movimiento** (lista con miniatura animada): ver §6.
- **Unidad:** letra · palabra · línea · todo.
- **Orden:** izquierda → derecha · desde el centro · aleatorio.
- **Desfase** entre unidades (ms) y **duración** (s).
- **Carácter** de la curva: Snap (arranque brusco, asentamiento largo, exceso 3–6 %) · Suave · Rebote.
- **Intensidad**: tiene un significado concreto por movimiento (§6), con su nombre real en la etiqueta ("Distancia",
  "Escala inicial", "Desenfoque"), nunca "intensidad" a secas.
- **Acentos** (sección aparte dentro de la pestaña): golpes puntuales que se disparan en ese momento. Flash · Shake ·
  Glitch · Aberración cromática · Destello (lens streak). Cada uno con cantidad y en qué punto (al empezar / al asentar).
- La salida por defecto es la inversa de la entrada, más corta (70 %) y con curva de aceleración; se puede elegir otra.

### 3.5 Propiedades
- Tamaño, posición (centro · tercio inferior · esquina para marca de agua, más x / y numéricos; sin arrastrar
  sobre el lienzo), espaciado
  (tracking), interlineado, alineación.
- Duraciones: entrada · **mantener** · salida.
- **Mantener**: movimiento secundario — Quieto · Push (acercamiento lento 3 %) · Deriva · Flotar (onda por letra) ·
  Respirar (glow) · Pulso con el bajo (si hay canción cargada).
- Formato 16:9 · 9:16 · 1:1 (4K opcional), 30/60 fps.

### 3.6 Efectos (pestaña; como el apartado de efectos de Grade, pero para vídeo)
- Una pila de efectos sobre el fotograma completo, con la misma interfaz que Grade: añadir desde una lista por grupos,
  reordenar, ocultar, borrar, cantidad y parámetros de cada uno. Reutiliza los efectos de `grader.js` que tengan
  sentido y les da tiempo: todo lo aleatorio cambia por fotograma (con semilla) y casa con el bucle de mantener.
- **Luz:** Bloom · Halation · Glints (destellos en estrella que giran) · Light leak (fuga de luz que se desplaza) ·
  Viñeta.
- **Textura:** Grano animado · Polvo y rayas de película · Scanlines · Halftone.
- **Óptica:** Motion blur (obturador) · Aberración cromática · RGB shift · Ghost / eco (estela de fotogramas
  anteriores).
- **Vídeo:** Flicker de película · Gate weave (vaivén del proyector) · VHS (tracking, sangrado de color) · Look de
  Grade (cualquier look con su cantidad).
- Sin efectos por defecto salvo lo que traiga el preset visual (grano leve). Los efectos van en el preset visual al
  guardarlo.

### 3.7 Exportar (pestaña)
- **Alfa** (por defecto): MOV ProRes 4444 · WebM VP9 · secuencia PNG. Aviso de una línea: CapCut y la mayoría de
  editores móviles no leen alfa bien; para ellos, quemado.
- **Quemado sobre vídeo:** MP4 H.264 con el texto sobre la imagen o el vídeo del contexto. El vídeo solo se usa de
  fondo: sin recortar ni editar.
- **Imagen fija** PNG con alfa (fotograma al final de la entrada por defecto).
- Tramo: completo · solo entrada · mantener en bucle · solo salida (de la v1).

---

## 4. Modelo de datos

```json
{
  "version": 2,
  "visual": "chrome-impact", "motion": "impact",
  "text": { "title": "HALATION", "sub": "", "font": "Archivo", "weight": 900, "width": 125, "case": "upper",
            "subFont": "Inter", "subWeight": 500 },
  "style": { "id": "chrome", "material": "chrome", "params": {}, "light": { "angle": -25, "spec": 1, "sweep": true, "every": 3 },
             "outlines": [], "extrude": null, "glow": null, "layers": { "line": true, "flare": true } },
  "in":  { "on": true, "id": "slam", "unit": "letter", "order": "center", "stagger": 0.03, "dur": 0.8, "curve": "snap",
           "amount": 1.35, "accents": [{ "id": "flash", "at": "settle", "amount": 0.6 }] },
  "out": { "on": true, "id": "lift", "unit": "letter", "order": "ltr", "stagger": 0.02, "dur": 0.5, "curve": "smooth",
           "amount": 0.25, "accents": [] },
  "props": { "size": 0.13, "x": 0.5, "y": 0.5, "tracking": 0.06, "lineHeight": 1.0, "align": "center",
             "hold": { "id": "push", "amount": 0.03 }, "holdDur": 2.2, "format": "16:9", "k4": false, "fps": 30 },
  "effects": [{ "fx": "grain", "on": true, "amount": 0.12 }],
  "context": { "type": "checker", "asset": null },
  "export": { "mode": "alpha", "format": "prores4444", "range": "full" }
}
```

- El motor de la v1 (`intro-engine.js`: WebGL2, SDF, render por unidad, worker, exportación) se conserva. El documento
  v2 se **compila** a un proyecto del motor (`build(doc) → project`): título, subtítulo y capas del preset de animación
  (línea, destello) se convierten en elementos con sus tiempos desfasados. El usuario nunca ve elementos.
- Un proyecto v1 guardado se abre convertido: material Glass → Chrome, Dither/ASCII/Inverse → Solid; imágenes
  descartadas con un aviso de una línea.
- Presets guardados: `Documents\Halation\Presets\Intro\{Visual,Motion}\*.json` (sustituyen Project/Style).

## 5. Materiales (shaders)

Todos parten del SDF y de las normales de bisel de la v1. Lo que cambia es la luz.

| Material | Cómo se construye | Parámetros (por defecto) |
|---|---|---|
| **Chrome** | Mapa de entorno de estudio procedural (cielo, horizonte con línea de luz, suelo oscuro, dos softboxes) reflejado con la normal del bisel; Fresnel (Schlick) que aclara bordes; especular GGX con luz clave y de relleno; microrrayado anisótropo muy leve; **barrido** del especular que cruza al asentar la entrada y cada N s | entorno Studio / Cool / Dark (Studio); bisel 7 % em; perfil redondo; rugosidad 0.18; barrido cada 3 s |
| **Gold** | El cromo con reflectancia de oro (F0 ≈ 1.0, 0.78, 0.34), sombras marrones cálidas y especular casi blanco | entorno Warm; rugosidad 0.22 |
| **Halation** | Núcleo casi blanco con borde tintado + **bloom real en varias escalas** (3 desenfoques gaussianos sumados, radios 1×, 3×, 8×) con el halo rojo/naranja de la película; grano propio sobre el halo | núcleo #fff4ea; halo cálido #ff5a2a / frío #6aa0ff; radio 4 % del lienzo; intensidad 1 |
| **Gradient** | Degradado de 2–4 paradas en espacio perceptual (OKLab), con un bisel suave iluminado (luz difusa + especular débil) y **grano** fino animado que evita bandas | paradas, ángulo 90°, grano 0.25, desplazamiento animado 0 |
| **Solid** | Color plano con bisel opcional muy leve (0 por defecto) | color #f2efe9 |

**Acabados** (cualquier material):
- **Contornos múltiples** (hasta 3), desde el SDF: sin coste de desenfoque, con separación entre ellos.
- **Extrusión 3D real en el shader:** se marcha por el SDF a lo largo de la dirección de extrusión (hasta 64 pasos,
  sin copias visibles), el lateral se ilumina con la normal del borde y oscurece con la profundidad; cara frontal
  con su bisel encima.
- **Glow**: bloom en dos escalas del propio texto (no un halo del SDF).
- **Sombra** suave de contacto.

## 6. Movimientos

Curvas de carácter (todas deterministas):
- **Snap:** muelle críticamente amortiguado ligeramente subamortiguado (ζ ≈ 0.72): llega en ~35 % del tiempo y
  asienta con un exceso de 3–6 %.
- **Suave:** expo-out. **Rebote:** muelle ζ ≈ 0.45.

| Id | Nombre | Qué hace | "Intensidad" es… | Por defecto |
|---|---|---|---|---|
| `slam` | Slam | cada unidad llega desde grande (escala 1.35 → 1) con desenfoque de movimiento y opacidad | Escala inicial (1.1–3) | 0.8 s, letra, desde el centro, 30 ms, Snap |
| `rise` | Rise | sube desde debajo de una línea de corte invisible (máscara por línea), sin fundido | Distancia (% del alto) | 0.9 s, palabra, 60 ms, Snap |
| `pop` | Pop | escala 0 → 1 con giro leve (±8°) | Exceso del rebote | 0.7 s, letra, 35 ms, Rebote |
| `focus` | Focus | desenfoque 30 px → 0 y tracking abierto que se cierra | Desenfoque (px) | 1.2 s, letra, 20 ms, Suave |
| `ignite` | Ignite | cada letra se enciende como un neón: parpadeos aleatorios y luego fijo | Número de parpadeos | 1.0 s, letra, aleatorio |
| `draw` | Draw | el contorno se dibuja con un barrido y luego se rellena | Retardo del relleno | 1.2 s, todo, Suave |
| `wipe` | Wipe | máscara con borde suave que avanza | Suavidad del borde | 0.7 s, línea |
| `slide` | Slide | entra desplazándose en horizontal con desenfoque direccional | Distancia | 0.7 s, palabra, Snap |
| `fade` | Fade | opacidad + escala 0.98 → 1 | — | 0.4 s, todo |

**Capas de un preset de animación** (entran desfasadas, las añade `build`): subtítulo (entra 0.15 s después, `rise`
por palabra, más lento), línea fina que se extiende desde el centro, destello (lens streak horizontal) que cruza en el
asentamiento.

**Acentos:** Flash (el fotograma se aclara 0.1 s), Shake (sacudida amortiguada de 0.25 s), Glitch (cortes y RGB de la
v1, 0.2 s), Aberración (separación RGB que decae), Destello (streak + bloom puntual).

## 7. Presets incluidos

Dos familias independientes. Cada preset visual se ve bien con cada preset de animación.

### 7.1 Visuales (8)

| # | Preset | Tipografía y composición | Material y luz | Acabados |
|---|---|---|---|---|
| 1 | **Chrome** | Archivo 900 expandida, mayúsculas; subtítulo Inter 500 espaciado 0.4 | Chrome Studio, bisel 7 %, especular que barre cada 3 s | extrusión 3 % oscura, bloom leve de brillos |
| 2 | **Liquid Chrome** | Unbounded 700 | Chrome Cool, bisel almohadillado 10 % | extrusión 5 % azul acero |
| 3 | **Gold** | Cinzel 700, tracking 0.22 | Gold, bisel 5 %, barrido diagonal | glow cálido suave |
| 4 | **Halation** | Syne 800 | Halation cálido (bloom de película) | — |
| 5 | **Neon** | Michroma | Solid oscuro | 2 contornos (cian, magenta) + glow |
| 6 | **Phonk** | Archivo 900 condensada | Solid blanco | extrusión roja dura 6 % |
| 7 | **Gradient Pop** | Unbounded 800 | Gradient de 3 paradas con grano y bisel suave | extrusión del color oscuro |
| 8 | **Clean** | Hanken Grotesk 700 + subtítulo 400 | Solid #f2efe9 | sombra suave |

### 7.2 Animación (8)

Cada uno define **las cuatro cosas del movimiento caro**: capas desfasadas, curva con carácter, movimiento
secundario en el mantener y luz que se mueve (el barrido del especular o el pulso del glow, si el visual los tiene).

| # | Preset | Entrada | Mantener | Salida | Capas y acentos |
|---|---|---|---|---|---|
| 1 | **Impact** | Slam por letra desde el centro, 0.8 s, Snap | Push 3 % | Lift por letra 0.5 s | línea + destello al asentar, Flash 0.5 |
| 2 | **Rise** | Rise por palabra 0.9 s, Snap | Deriva | Rise inverso 0.6 s | subtítulo desfasado |
| 3 | **Cinematic** | Focus por letra 1.6 s, Suave | Push 2 % | Focus inverso 1.0 s | dos líneas que se abren |
| 4 | **Neon On** | Ignite aleatorio 1.0 s | Respirar | Fade 0.5 s | — |
| 5 | **Draw** | Draw 1.2 s | Flotar | Wipe 0.6 s | — |
| 6 | **Phonk Hit** | Slam por palabra 0.5 s, Snap 6 %, Shake + Aberración | Pulso (bajo) | Glitch + Fade 0.3 s | — |
| 7 | **Pop** | Pop por letra 0.7 s, Rebote | Flotar | Pop inverso 0.5 s | — |
| 8 | **Lower Third** | Rise por palabra + línea de acento a la izquierda | Quieto | Wipe 0.5 s | pensado para bucle de mantener y tercio inferior |

## 8. Criterios de aceptación

- **El listón:** con cada combinación de presets y solo cambiando el texto, el resultado se ve como un preset de pago. Juez: Java,
  con capturas de los 8 presets visuales y un vídeo de cada preset de animación, sobre ajedrez, oscuro y una imagen.
- Chrome: se lee como metal pulido (reflejo de entorno con horizonte, bordes con Fresnel, especular que barre).
  Gold: oro, no amarillo plano. Halation: bloom de película, no un contorno borroso.
- Extrusión sin escalones visibles a 1080p.
- Entrada y salida independientes: cambiar una no toca la otra ni la apariencia; cambiar la apariencia no toca el
  movimiento.
- Sin timeline ni pistas en la interfaz; cambiar de pestaña no mueve ni recarga el preview.
- El texto largo (3 líneas, 40 caracteres) se ajusta solo al lienzo sin salirse.
- Proyectos v1 guardados abren sin error.
- Determinismo, alfa sin halos y "mantener en bucle" sin cortes: como en la v1.
- Rendimiento: preview a 1080p ≥ 30 fps en una GPU media con la combinación más cara; exportación con motion blur.
- Tests solo de lo tocado: `intro.js`, `intro-bars.js`, `editor.js` (lo que siga aplicando) y uno nuevo de presets.

## 9. Fuera de alcance

Texto en trayectoria, partículas, cámara 3D real, keyframes o curvas manuales, imágenes y logos como elemento,
edición de vídeo (recortar, cortar, montar), varios bloques de texto independientes en el mismo clip. Van a
`ROADMAP.md` si se piden.

## 10. Fases de implementación

1. Shaders: Chrome, Gold, Halation (bloom multiescala), Gradient + grano, contornos múltiples, extrusión 3D.
2. Movimiento: curvas de muelle, unidades y orden, nuevos movimientos, acentos, capas.
3. Modelo v2 y `build`, conversión de v1, los presets incluidos.
4. Interfaz: texto y presets a la izquierda, preview con su barra, ajustes por pestañas a la derecha.
5. Tests de lo tocado, capturas y vídeos para Java.
