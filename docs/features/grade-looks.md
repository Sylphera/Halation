# Grade — Rework de looks (especificación v1)

Status: Planned — not ported to the native app; implemented in the Tauri app on `main`.

Java, 2026-10-13. Rehacer la parte de filtros/looks de Grade: looks que modifican varias dimensiones de la imagen a la
vez (tono, color por zonas, saturación selectiva, fade, grano…), una biblioteca propia y curada, intensidad que mezcla
el tratamiento completo, ajustes sobre un look aplicado, My Looks como variantes guardadas y Favorites. Sin perder el
trabajo de rendimiento de 1.1.1 (`research/performance/frame-budget-111/FINAL.md`).

Esta spec no se implementa hasta que Java la apruebe.

---

## 0. Principios

1. **Un look es un tratamiento completo**, no un tinte: curva tonal, color por zonas de luminancia, saturación
   selectiva, negros/luces, fade y acabado (grano, halation, viñeta…) coordinados. El usuario no ve sus piezas.
2. **Un look es datos, no código.** Añadir un look = añadir una entrada al catálogo (+ su nombre en `en.json`). El
   renderer no tiene ramas por look.
3. **Un solo pipeline.** Vista previa, miniaturas, lotes y exportación pasan por la misma función de color y los mismos
   pases. Lo único que cambia es la resolución.
4. **Determinista.** Misma entrada + mismo look + mismos ajustes → mismos bytes. Sin `Math.random`, sin semillas por
   sesión. Los LUT se verifican por hash.
5. **Intensidad = mezcla del look entero** con la imagen que entra en la capa.
6. **Sin daños accidentales.** Clipping, negros aplastados, luces quemadas, saturación absurda o giros de tono que
   rompan colores solo si el look los declara como intención (§7).
7. **Referencia central: Fotor.** Un filtro aplicado ya da una imagen terminada porque combina varias
   modificaciones tonales y cromáticas, no una capa de color. Se toma su forma de construir looks (curva + color por
   zonas + saturación selectiva + acabado, con una sola intensidad), no sus filtros, nombres ni LUTs.
8. **El rendimiento de 1.1.1 se conserva** (§8): nada se procesa con Grade oculto, nada se regenera sin cambios, ningún
   recurso crece sin límite.

---

## 1. Punto de partida (lo que existe hoy)

| Pieza | Dónde | Hoy |
|---|---|---|
| Catálogo | `grader.js` → `LOOKS` (38), `CATS` (10 categorías, ids en español) | Cada look = `g` (parámetros del grader) + `fx` (lista de efectos). |
| Color | `grade-color.js` → `makeGrader`, `buildLUT` | Cadena fija y global: temp/tint (desplazamiento RGB lineal), exposición, sombras/luces cúbicas, crush, contraste sigmoide, gamma, curvas m/r/g/b, matriz de tono, saturación/vibrance, B&N, tono de sombras/luces (cuadrático), gradient map, lift, cap. `c01` (clamp duro) entre muchos pasos. |
| LUT | `grade.js` → `makeLUT`, `uploadLUT`, `lookLUT` | 33³ **RGBA8**, una por look, en `lookLUTs` sin límite ni liberación. Las capas Adjust/Gradient map construyen su LUT **en el hilo principal** (`layerLUT`). |
| Intensidad | `grade.js` → `applyLayer` | La LUT se mezcla con `amt`; cada efecto del look multiplica su fuerza por `amt` por separado. No es una mezcla del resultado completo. |
| Miniaturas | `grade.js` → `scheduleThumbs`, `pumpThumbs`, `prepareThumbLUT` | 160 px, mismo `renderStack` (pila viva + el look candidato a `G.thumbPct`), LUT en `grade-lut-worker.js` (una petición a la vez), una lectura PBO/fence a la vez, todo cancelado al ocultar (`__ui.onAway`). Se regeneran solo si cambia la clave (capas, %, tamaño, fuentes). |
| My Looks | `grade.js` → `saveLook`, `renderLooks`; `shim.js` (`grade`) | Una pila de capas entera guardada en `Presets/Grade/<nombre>.json` (`{app:"halation-grade", version:1, layers}`). La Library los indexa como `type: "look"` (rename/duplicate/delete en `shell.js presetAction`). |
| Pruebas | `tests/grader-lut.cjs` + `grader-lut-baseline.json` | 42 hashes de LUT (38 looks + 4 muestras) idénticos a `edf8a82`. `grade-thumbnails.js`, `grade-resources.js`, `grade-runtime.js`. |

Limitaciones que explican "se siente como un tinte": todas las operaciones son globales o con pesos de luminancia
cuadráticos; no hay saturación ni tono selectivos por color, ni protección de piel, ni compresión de altas luces
(shoulder), ni recorte suave de gama; el `c01` intermedio quema luces antes de la curva; LUT de 8 bits con interpolación
trilineal produce escalones en degradados.

---

## 2. Distribución

### 2.1 Panel izquierdo, pestaña Filters

```
┌──────────────────────────────────────┐
│ [Filters] [Tools] [Mine]             │
│  All │ ★ Favorites │ My Looks        │  ← subpestañas de Filters
│ ──────────────────────────────────── │
│ ┌──────────────────────────────────┐ │
│ │ ⌕ Search looks                   │ │
│ └──────────────────────────────────┘ │
│ (Every)(Film)(Cinematic)(Vintage)    │  ← categorías, solo en All,
│ (Warm)(Cold)(Faded)(Mono)…           │    en su propia fila debajo
│ Preview strength ───────●── 100 %    │
│ ┌──────┐┌──────┐┌──────┐             │
│ │ img  ││ img  ││ img ★│  ← estrella │
│ │      ││  ✓   ││      │    al pasar │
│ └Name──┘└Name──┘└Name──┘    o si fav │
│ …                                    │
└──────────────────────────────────────┘
```

- **Subpestañas de Filters**: `All`, `Favorites`, `My Looks`. Son pestañas separadas (no chips) y siempre visibles;
  cada una recuerda su scroll y su búsqueda mientras Grade está abierto.
  - `All`: todos los looks incluidos. Debajo del buscador, separada, una fila de chips de categoría (§5) con
    `Every` (sin filtro) como primera. Cada vez que Grade se abre vuelve a `Every` (estado de interfaz, DECISIONS).
  - `Favorites`: looks incluidos y personales marcados, en el orden en que se marcaron. Vacía: texto que explica la
    estrella.
  - `My Looks`: los looks personales (§3.3), por nombre. Vacía: texto que explica `Save as My Look`.
  - `Favorites` y `My Looks` no tienen fila de categorías en v1; el buscador sí.
- Buscador: filtra la subpestaña activa por nombre, categoría y etiquetas del look (§3.1 `tags`). Sin resultados:
  texto vacío.
- Tile: miniatura, nombre, estrella (visible al pasar/con foco; rellena si es favorito) y la marca ✓ si el look está en
  Layers (sin contador ni botones `+` / `−`). Las tiles de My Looks añaden un menú `⋯`: Rename, Duplicate, Delete,
  Favorite.
- **Clic en una tile = preview** (Java, 2026-10-13): el look se ve en el lienzo encima de los looks de Layers, sin
  crear capa; la tile queda marcada y aparece sobre la imagen la barra `Preview <nombre> · Cancel · Add to layers`.
  Otro clic en otra tile cambia la preview; Esc o Cancel la quitan. `Add to layers`, un doble clic o Enter sobre la
  tile en preview añaden **una** capa encima de las demás. La exportación, el historial y el estado nunca llevan la
  preview. Abrir una herramienta de Effects quita la preview (una sola cosa a prueba).
- `Preview strength` (el `thumbPct` actual) sigue igual.

### 2.2 Panel derecho, capa de look abierta

```
┌ Cinematic Teal ··· Film ──────── ⋯ ┐
│ Intensity      ─────────●──  85 %  │
│ ── Adjust look ──────────────────  │
│ Exposure       ────●──────   0     │
│ Warmth         ──────●────  +12    │
│ Contrast       ────●──────   0     │
│ Highlights     ────●──────   0     │
│ Shadows        ──────●────  +20    │
│ Saturation     ────●──────   0     │
│ Fade           ────●──────   0     │
│ Grain          ──────●────  +30    │
│ [Reset adjustments] [Save as My Look]│
└────────────────────────────────────┘
```

- Los ajustes son **relativos al look** (0 = el look tal cual). Doble clic en un control lo vuelve a 0 (la
  convención actual de sliders).
- `Save as My Look` pide un nombre (validación de nombres de la Library: vacío, caracteres, duplicado).
- Una capa con ajustes distintos de 0 muestra un punto junto al nombre.

### 2.3 Pestaña Mine

Sigue con las pilas guardadas (v1) y los lotes. Los looks personales (v2, §3.3) no aparecen aquí: viven en la rejilla.

---

## 3. Modelo de datos

### 3.1 Definición de un look incluido (`app/dist/grade-looks.js`, solo datos)

```js
{
  id: "cine-teal",            // estable, kebab-case; se guarda en capas y My Looks
  rev: 1,                     // sube si cambia el aspecto tras publicarse (§3.4)
  cat: "cinematic",           // id estable de §5; etiqueta en en.json (cat2.<id>)
  tags: ["portrait", "skin-safe"],
  intent: { crush: false, clip: false, mono: false, hueShift: false },   // §7: excepciones declaradas
  color: {                    // todo esto se hornea en UNA LUT (§4.1); cada sección es opcional
    input:  { temp: 0, tint: 0, exposure: 0 },
    mixer:  [[1,0,0],[0,1,0],[0,0,1]],          // mezclador de canales (B&N con filtros, cross)
    tone:   { mode: "rgb", blacks: 0, shadows: 0, mids: 0, highlights: 0, whites: 0,
              contrast: 0, pivot: 0.43, toe: 0, shoulder: 0 },
    curves: { m: null, r: null, g: null, b: null },          // puntos [[x,y]…], Fritsch-Carlson (mcurve actual)
    hsl:    [ { hue: 200, width: 40, dHue: 0, dSat: 0, dLight: 0 } ],      // bandas por tono (OKLCh)
    sat:    { global: 1, vibrance: 0, byLuma: [1, 1, 1] },               // sombras / medios / luces
    zones:  { shadows: { hue: 210, sat: 0 }, mids: { hue: 0, sat: 0 }, highlights: { hue: 40, sat: 0 },
              balance: 0, blend: 0.5 },
    skin:   { protect: 0 },                     // 0…1: cuánto se protegen los tonos de piel de hsl/zones/input
    lut:    null,                               // { file: "looks/luts/<id>.cube", amt: 1 } — solo LUTs propias
    fade:   { black: 0, white: 1, matte: 0 },
    gamut:  { soft: true }
  },
  finish: [                    // pases espaciales existentes (FX de grader.js), orden fijo §4.2
    ["halation", { threshold: 0.75, radius: 14, intensity: 0.35, tint: "#ff5a2a" }],
    ["grain",    { size: 1.3, strength: 0.28, colored: false }]
  ]
}
```

Valores por defecto de cada campo = neutro (la sección omitida no hace nada). Rangos:

| Campo | Rango | Defecto | Nota |
|---|---|---|---|
| `input.temp` / `tint` | −1…1 | 0 | Balance de blancos en LMS/Bradford, no suma RGB. |
| `input.exposure` | −2…2 EV | 0 | En lineal. |
| `tone.mode` | `rgb` \| `luma` | `rgb` | `rgb`: por canal (desatura luces como película). `luma`: sobre L de OKLab, conserva el color. |
| `tone.blacks` / `whites` | −0.2…0.2 | 0 | Mueven el punto negro / blanco de la curva. |
| `tone.shadows` / `mids` / `highlights` | −1…1 | 0 | Pesos suaves por zona (no cúbicos). |
| `tone.contrast` | −1…1 | 0 | Alrededor de `pivot`, en dominio logarítmico. |
| `tone.pivot` | 0.2…0.6 | 0.43 | Gris medio percibido. |
| `tone.toe` / `shoulder` | 0…1 | 0 | Rodilla de sombras / compresión de altas luces (rolloff). |
| `hsl[].hue` / `width` | 0…360° / 10…120° | — | Banda en OKLCh con caída suave. Máx. 8 bandas. |
| `hsl[].dHue` / `dSat` / `dLight` | ±30° / −1…1 / −0.5…0.5 | 0 | |
| `sat.global` | 0…2 | 1 | En OKLCh (croma), no mezcla con luma. |
| `sat.vibrance` | −1…1 | 0 | Pesa más los colores poco saturados. |
| `sat.byLuma` | 0…2 ×3 | [1,1,1] | Saturación por zona de luminancia. |
| `zones.*.hue` / `sat` | 0…360° / 0…0.3 | — / 0 | Color grading de tres vías. |
| `zones.balance` | −1…1 | 0 | Desplaza la frontera sombras/luces. |
| `zones.blend` | 0…1 | 0.5 | Solape entre zonas. |
| `skin.protect` | 0…1 | 0 | Banda de piel OKLCh h ≈ 55° ± 25°, C < 0.15; se ajusta con el set de prueba en F0. |
| `fade.black` / `white` | 0…0.25 / 0.75…1 | 0 / 1 | Levantar negros / bajar blancos. |
| `fade.matte` | 0…1 | 0 | Compresión suave de sombras hacia `black` (mate de película). |
| `gamut.soft` | bool | true | Recorte suave de croma en OKLCh conservando tono, en vez de `c01` por canal. |

`finish` usa los efectos de `FX` con sus mismos parámetros; se añade a `grain` un parámetro `shadows` (0…1, defecto
0.5: cuánto más grano en sombras/medios que en luces) para el grano de película. Ningún otro efecto nuevo en v1.

### 3.2 Capa de look (estado, historial, sesión, pilas guardadas)

```js
{ id, type: "look", id0: "cine-teal", amt: 85, on: true,
  adj: { exposure: 0, warmth: 12, contrast: 0, highlights: 0, shadows: 20, saturation: 0, fade: 0, grain: 30 },
  def: null }   // def: definición incrustada (solo en looks personales, §3.3)
```

`adj` omitido = todo 0. `validLayer` acepta `adj` y descarta claves desconocidas o fuera de rango.

### 3.3 Look personal (My Looks)

Mismo archivo y misma carpeta que hoy (`Presets/Grade/<nombre>.json`), con una sola capa de look:

```json
{ "app": "halation-grade", "version": 2, "kind": "look",
  "base": { "id": "cine-teal", "rev": 1 },
  "layers": [ { "type": "look", "id0": "cine-teal", "on": true, "amt": 85,
                "adj": { "warmth": 12, "shadows": 20, "grain": 30 },
                "def": { "…definición completa del look base en el momento de guardar…" } } ] }
```

- `def` es una copia de la definición base: el look personal da **exactamente** el mismo resultado aunque el catálogo
  cambie o el look base desaparezca. `base` solo sirve para mostrar "Based on Cinematic Teal".
- Un archivo v2 se lee también como pila (tiene `layers`), así que `shim.js`, la Library y `lookThumb` de `shell.js`
  siguen funcionando; quien no conozca `adj`/`def` lo ignora.
- Un archivo v1 con exactamente una capa de look y nada más **no** se convierte: sigue en Mine como pila.
- Duplicate/Rename/Delete: los de la Library (`preset_rename`, `preset_delete`), también desde el menú `⋯` de la tile.
- Aplicar un look personal crea una capa con su `id0`, `amt`, `adj` y `def`; se puede volver a ajustar y guardar como
  otro look personal (o sobrescribir el mismo, con confirmación).

### 3.4 Versionado de looks incluidos

Un look publicado no cambia de aspecto en silencio. Si hay que retocarlo, sube `rev` y la versión anterior pasa a la
tabla de looks antiguos (§3.5) con `id@rev`, para que las capas guardadas que la usaban sigan iguales.

### 3.5 Looks actuales (legado)

- Los 38 looks actuales pasan a `grader-legacy.js` (o una sección `legacy` de `grader.js`) con su `makeGrader` actual,
  **sin tocar sus bytes** (los 42 hashes de `grader-lut-baseline.json` siguen pasando).
- No aparecen en la rejilla. Una capa, sesión, pila o look de la Library que los use se ve exactamente igual; su fila
  muestra "Classic". *(Decisión por defecto, §11.)*
- Los que tienen identidad útil (§6) se reconstruyen como looks nuevos con otro `id`; no hay migración automática de
  capas antiguas a los nuevos.

### 3.6 Favorites

- Una lista en el estado de Grade (`state_set "grade"` vía `shim.js`): `favs: ["b:cine-teal", "u:<nombre>"]`.
- Renombrar o borrar un look personal actualiza / quita su entrada.
- La estrella de la Library sobre el archivo y Favorites de Grade son independientes en v1 (§10).

---

## 4. Motor

### 4.1 Color: una LUT por (look, ajustes)

`grade-color.js` añade `compileLook(def, adj)` → función pura `(r,g,b) → [r,g,b]` y `buildLookLUT(def, adj)`.
Orden fijo de la cadena (no configurable por look, para que todos sean comparables):

1. Decodificar sRGB → lineal.
2. `input` (balance de blancos y exposición) + ajustes de usuario `warmth`, `exposure` (pre-look: el look reacciona
   como a otra foto).
3. `mixer`.
4. `tone` (curva paramétrica; `rgb` o `luma`), luego `curves`.
5. `hsl` (bandas), `sat` (global, vibrance, por luma), `zones` (tres vías); `skin.protect` atenúa 2–5 dentro de la
   banda de piel.
6. `lut` (si existe; 33³, `.cube` propia).
7. Ajustes de usuario post-look: `contrast`, `highlights`, `shadows`, `saturation`, `fade`.
8. `fade` del look.
9. `gamut.soft` y codificar a sRGB. **Sin clamps intermedios**: los valores fuera de rango viajan hasta el paso 9.

Formato de LUT nuevo: 33³ **RGBA16F** (`texImage3D` con `RGBA16F`/`FLOAT`, filtrable en WebGL2), ~287 KB por LUT.
Los looks legado mantienen RGBA8. El shader `lut` no cambia (coordenadas de texel iguales). Si en F0 el set de prueba
sigue mostrando escalones en degradados, se sube a 49³ solo para los looks nuevos (decisión medida, no por defecto).

### 4.2 Acabado: pases espaciales y mezcla única

`applyLayer` para un look nuevo:

1. `entrada` = el target que llega a la capa.
2. LUT del look (a intensidad 1).
3. `finish` en orden fijo: halation → bloom → glow → leak → vignette → grain → dust (los que tenga), con
   `grain.strength` multiplicado por `1 + adj.grain/100` (y un grano por defecto del look si no tenía y `adj.grain > 0`).
4. Si `amt < 100`: un pase `mixfx(entrada, resultado, amt)` (el shader ya existe). Con `amt = 100`, sin pase extra.

Un look solo-color (sin `finish`) mezcla dentro del pase `lut` (`amt` uniforme) como hoy, sin pase extra.

### 4.3 Construcción y caché de LUTs

- Todas las LUT nuevas (looks, ajustes en curso, miniaturas) se construyen en `grade-lut-worker.js` (una petición a la
  vez, **la última gana**: mientras se arrastra un ajuste solo se construye el valor más reciente). Fallback síncrono
  como hoy si el worker falla.
- Mientras llega la LUT nueva, la vista sigue con la anterior de esa capa (sin parpadeo ni capa vacía).
- La textura de una capa se reutiliza (`uploadLUT(data, old)`), no se recrea por cada ajuste.
- Caché `lookLUTs` con clave `id@rev|hash(adj)` y límite LRU: las LUT de capas presentes + 24 más (~7 MB en 16F).
  Las que salen se borran con `gl.deleteTexture`.
- La exportación usa la misma LUT; si no está lista, la construye de forma síncrona antes de dibujar.

### 4.4 Ajustes de usuario sobre un look (valores por defecto 0)

| Ajuste | Rango | Dónde actúa |
|---|---|---|
| Intensity (`amt`) | 0…100 % | Mezcla final §4.2.4. Defecto: `Preview strength`. |
| Exposure | −100…100 (= ±1 EV) | Pre-look (paso 2). |
| Warmth | −100…100 | Pre-look (paso 2), balance de blancos. |
| Contrast | −100…100 | Post-look (paso 7), alrededor del pivot del look. |
| Highlights | −100…100 | Post-look, con shoulder suave (bajar no aplana; subir no quema: tope en `gamut`). |
| Shadows | −100…100 | Post-look, con toe suave. |
| Saturation | −100…100 | Post-look, croma OKLCh con vibrance implícita (protege tonos ya saturados). |
| Fade | 0…100 | Post-look, levanta negros y baja blancos (mate). |
| Grain | −100…100 | Escala el grano del look (−100 lo quita). |

Lista cerrada para v1; no se exponen las piezas internas del look.

### 4.5 Miniaturas

- Mismo `renderStack` que hoy, 160 px. La miniatura de cada tile muestra lo que previsualizaría un clic: el look
  candidato a `Preview strength` encima de los looks de Layers y debajo de los efectos, así cualquier cambio en Layers
  recalcula las miniaturas (Java, 2026-10-14: antes mostraban el look solo y no seguían a las capas).
  Para My Looks: con sus `adj` y su `def`.
- Orden de la cola: tiles visibles primero (IntersectionObserver), luego el resto en la misma cola de una en una.
  Tiles ocultas por subpestaña, categoría o búsqueda no se calculan hasta que se muestran.
- Las LUT de miniaturas pasan por la caché LRU (§4.3): recorrer los ~70 looks no deja 70 texturas vivas.

---

## 5. Categorías (ids estables, etiquetas en `en.json`)

`film`, `cinematic`, `vintage`, `instant`, `warm`, `cold`, `faded`, `mono`, `contrast`, `soft`, `landscape`,
`night`, `dreamy`, `vivid`. 14 categorías, 4–6 looks cada una. `All`, `Favorites` y `My Looks` son subpestañas, no categorías (§2.1).

## 6. Catálogo inicial

Objetivo v1: **~60–70 looks**, cada uno distinto de los de su categoría en al menos dos dimensiones (tono, reparto de
color por zonas, saturación selectiva, acabado). La lista es la dirección de cada uno; los nombres son provisionales y
propios (sin marcas de película ni nombres de otras apps). Cada look se autoriza con el set de prueba (§7) y se revisa
en hoja de contactos antes de entrar.

| Cat. | Looks (dirección) |
|---|---|
| film | **Negative Warm** (shoulder largo, piel cálida, verdes hacia oliva, grano fino) · **Negative Cool** (sombras cian-verde, luces neutras, saturación baja en azules) · **Slide** (contraste alto, saturación por zonas alta en medios, negros densos) · **Pushed** (contraste y grano fuertes, negros comprimidos, color apagado) · **Expired** (dominante magenta en sombras, verde en luces, fade, grano grueso) · **Tungsten Stock** (azul global compensado, piel protegida, halation) |
| cinematic | **Teal & Orange** (sombras teal, piel naranja protegida, azules reducidos sin desaturar todo) · **Bleach** (bypass: contraste alto, saturación −60 % salvo rojos) · **Blockbuster** (shoulder fuerte, negros fríos, luces cálidas) · **Noir Color** (casi monocromo con rojos conservados) · **Desert** (ámbar en medios, cielos hacia cian, polvo/fade) · **Neo** (verde en sombras, magentas reducidos, contraste medio) |
| vintage | **70s** (amarillo en luces, marrón en sombras, saturación baja) · **Sepia Print** (virado sepia con negros levantados) · **Archive** (rojos profundos, azules cian, fade) · **Postcard** (cian en luces, rojo-naranja saturado en medios) · **Daguerre** (monocromo cálido, viñeta) |
| instant | **Instant Cool** (cian en sombras, blancos cremosos, contraste bajo) · **Instant Warm** (amarillo, rojos suaves, luces comprimidas) · **Peel-Apart** (magenta y verde cruzados, borde de viñeta) · **Square** (contraste medio, fade fuerte, saturación media) |
| warm | **Golden Hour** (naranja en luces, sombras neutras, verdes cálidos) · **Honey** (amarillo en medios, piel protegida) · **Terracotta** (rojos/naranjas al alza, azules reducidos) · **Ember** (contraste alto, sombras rojizas, halation) · **Sunlit** (exposición +, shoulder suave, cálido limpio) |
| cold | **Nordic** (azul en sombras, piel conservada cálida, saturación baja) · **Steel** (casi desaturado frío, contraste medio-alto) · **Glacier** (cian en luces, blancos limpios, fade leve) · **Blue Hour** (azul profundo en medios, luces naranjas puntuales) · **Frost** (luces altas brillantes, croma bajo, bloom suave) |
| faded | **Matte** (negros levantados, contraste suave, color intacto) · **Washed** (saturación baja, luces lechosas) · **Dust** (fade cálido + polvo) · **Pastel** (vibrance alta en tonos poco saturados, contraste bajo) · **Haze** (glow + fade azulado) |
| mono | **Classic BW** (mezcla equilibrada) · **High Key BW** (luces abiertas, toe suave) · **Noir** (filtro rojo, contraste fuerte, grano) · **Silver** (contraste bajo, tonos plateados ligeramente fríos) · **Selenium** (virado frío en sombras, cálido en luces) · **Ghost Leaf** (B&N tipo infrarrojo: verdes muy claros, cielos oscuros) |
| contrast | **Punch** (S marcada, saturación selectiva en medios) · **Graphic** (contraste extremo intencional, `intent.clip`) · **Deep** (negros densos con detalle, luces protegidas) · **Hard Light** (clarity tonal, croma limitado) |
| soft | **Soft Skin** (contraste bajo en medios, piel protegida, rojos suavizados) · **Airy** (exposición +, croma bajo, sombras azuladas leves) · **Cream** (blancos cálidos, negros suaves) · **Velvet** (sombras profundas suaves, glow leve) |
| landscape | **Greens** (verdes ricos sin amarillear, cielos azules profundos) · **Autumn** (amarillos/verdes hacia naranja) · **Alpine** (azules limpios, contraste medio, shoulder para nieve) · **Coast** (cian y arena, luces protegidas) · **Moody Forest** (verdes apagados, sombras frías, fade) |
| night | **Neon City** (magentas y cian, negros limpios, bloom) · **Sodium** (naranja de farola en luces, sombras teal) · **Moonlight** (azul frío, exposición −, croma bajo) · **After Dark** (contraste alto, color selectivo en luces) |
| dreamy | **Glow** (glow + halation, contraste bajo) · **Lavender** (violeta en sombras, rosa en luces) · **Daydream** (exposición +, pastel, bloom) · **Ethereal** (croma bajo, luces lechosas frías) |
| vivid | **Vivid** (vibrance alta, saturación de piel contenida) · **Pop** (contraste medio-alto, primarios separados) · **Tropical** (verdes y cian intensos, cálido en piel) · **Saturated Slide** (saturación alta en medios, negros densos) |

Total de la tabla: 67. La lista final puede quedarse por debajo si un look no pasa §7; no se rellena con variantes.

### 6.1 Looks actuales: todos se rehacen

Ningún look actual pasa al catálogo nuevo tal cual. Los que tienen identidad útil sirven de punto de partida y se
reconstruyen con el motor nuevo; el resto solo queda como legado para que el trabajo guardado se vea igual (§3.5).


| Actual | Destino |
|---|---|
| `portra`, `fuji`, `teal`, `bleach`, `cross`, `faded` | Base de film / cinematic / faded nuevos (reconstruidos con el motor nuevo). |
| `nocturno`, `medianoche`, `neonrojo`, `synth` | Base de night. |
| `polaroid` | Base de instant. |
| `bn`, `noir`, `plata`, `bnnoche` | Base de mono. |
| `sepia`, `ambar` | Base de vintage / warm. |
| `sueno`, `halo`, `etereo` | Base de dreamy. |
| `hielo`, `acero` | Base de cold. |
| `ultravioleta`, `sangre`, `dcian`, `dviol`, `drojo`, `trama` | Gradient maps/duotonos: no son looks fotográficos; quedan como legado. El Gradient map de Tools ya los cubre. |
| `vhs`, `ccd`, `glitch`, `destellos`, `matrix`, `esmeralda`, `violeta`, `profundo`, `humo`, `mate` | Legado. `mate`/`humo` inspiran faded; el resto son efectos o tintes. |

---

## 7. Calidad: set de prueba y criterios por look

### 7.1 Set de prueba

`app/tests/fixtures/looks/`: 14 imágenes propias o CC0 (licencia anotada en un `SOURCES.md`), 1024 px de lado mayor:
retrato luz día, retrato interior cálido, piel oscura, grupo, paisaje con cielo, paisaje verde, nocturna con luces,
interior oscuro (clave baja), clave alta, render 3D, portada con tipografía y colores planos, foto muy saturada, foto
casi monocroma, degradados sintéticos (rampa de grises, rampa de croma, rueda de tono).

### 7.2 Métricas automáticas (`app/tests/grade-looks-quality.js`, Node, sobre la función de color y los pases)

Para cada look × imagen, a intensidad 100 % y ajustes 0:

| Métrica | Límite (salvo `intent`) |
|---|---|
| Píxeles recortados a 0 o 255 en algún canal, nuevos respecto al original | ≤ 0.5 % (`intent.clip` / `intent.crush` lo levantan) |
| Rampa de grises: monotonía de L | Estrictamente no decreciente (sin inversiones). |
| Rampa de grises: escalones | Ningún salto entre muestras vecinas > 2× el paso medio (banding). |
| Croma máximo (OKLCh) | ≤ 0.32 (`vivid` hasta 0.37). |
| Giro de tono de la banda de piel (retratos) | ≤ 12° de media (`intent.hueShift` lo levanta). |
| Giro de tono fuera de piel por color primario | ≤ 25° (`intent.hueShift` lo levanta). |
| Distancia media entre looks de la misma categoría (ΔE OKLab sobre el set) | ≥ un umbral fijado en F0 con los looks aprobados (garantiza "distintos de verdad"). |
| Determinismo | Hash de la LUT de cada look en `grade-looks-baseline.json`; la del worker y la síncrona idénticas. |

### 7.3 Revisión visual

`app/scripts/look-sheet.js` genera una hoja de contactos por categoría (looks × imágenes del set) en `$SHOTS`. Java
aprueba cada tanda de looks sobre esas hojas antes de que entren en el catálogo.

---

## 8. Rendimiento (lo que no puede empeorar)

- Grade oculto: cero rAF, cero dibujos GL, worker cerrado, lecturas pendientes descartadas (`__ui.onAway`), como hoy.
- Miniaturas: solo cuando cambia su clave; una lectura PBO a la vez; ninguna generación continua.
- Ajustes arrastrados: una LUT en vuelo (la última gana); ningún `texImage3D` a textura nueva por cada movimiento.
- Recursos acotados: caché LUT con LRU (§4.3); `grade-resources.js` amplía sus ciclos (aplicar/quitar 70 looks,
  arrastrar ajustes 200 veces) y el número de texturas vuelve al mismo valor.
- Mediciones antes/después con los scripts de `frame-budget-111` (`grade-runtime`, `grade-thumbnails`,
  `grade-resources`): tiempo por miniatura, tiempo de LUT en el worker, máximo de frame al arrastrar un ajuste sobre
  una imagen de 2048². Criterio: ninguna peor que la línea base medida en F0 por encima del ruido de la medición; si la
  LUT 16F o el pase de mezcla la empeoran, se documenta y se decide antes de seguir.

---

## 9. Criterios de aceptación

1. Los looks nuevos están definidos solo como datos en `grade-looks.js`; `grade.js` no menciona ningún id de look.
2. Clic en una tile aplica (sustituye) el look; `+` apila; la miniatura coincide con lo que aparece al hacer clic
   (misma pila, misma intensidad) salvo la escala.
3. Intensity al 50 % de un look con LUT + grano + halation = mezcla al 50 % del resultado completo (prueba de píxel:
   `|out − mix(in, look100, 0.5)| ≤ 1/255` por canal).
4. Los 8 ajustes cambian el resultado en tiempo real sin bloquear la interfaz; Reset los vuelve a 0.
5. Save as My Look crea `Presets/Grade/<nombre>.json` v2; tras reiniciar, cambiar o quitar el look base del catálogo,
   aplicarlo da los mismos bytes en exportación.
6. Los looks personales aparecen en la subpestaña My Looks y en la Library; se pueden aplicar, ajustar, duplicar,
   renombrar y eliminar desde los dos sitios.
7. Favorites marca looks incluidos y personales; la subpestaña Favorites los muestra; persiste entre reinicios; renombrar mantiene la
   marca.
8. La exportación a resolución completa coincide con la vista previa salvo escala (prueba: exportar a la resolución de
   la vista previa y comparar ≤ 1/255).
9. Las capas, sesiones, lotes y pilas guardadas con looks actuales se ven exactamente igual (42 hashes de
   `grader-lut-baseline.json` intactos; una pila v1 de la Library se aplica igual).
10. Todos los looks del catálogo pasan §7.2; la hoja de contactos de cada categoría está aprobada.
11. §8 se cumple con las pruebas de rendimiento existentes en verde.
12. Textos nuevos solo en `en.json`.

---

## 10. Fuera de alcance (v1)

- Importar/exportar/compartir looks, importar `.cube` de terceros.
- Editor de las piezas internas de un look (curvas, bandas…) en la interfaz.
- Más ajustes que los 8 de §4.4; máscaras locales; auto-look por contenido de la imagen.
- Sincronizar Favorites de Grade con la estrella de la Library.
- Usar los looks nuevos en Intro/Visualizer (sigue en `planning/ROADMAP.md`).
- Export de 16 bits / HDR; el target de render sigue en RGBA8.
- Traducción al español (`es.json`), salvo petición.

## 11. Decisiones tomadas por defecto (cambiables antes de implementar)

1. Clic en tile **sustituye** el look; `+` apila (hoy cada clic apila).
2. Looks actuales **ocultos** como legado (render idéntico); alternativa: categoría visible "Classic".
3. Catálogo inicial de **~60–70** looks en tandas aprobadas por hoja de contactos.
4. Looks personales **autocontenidos** (`def` copiado); alternativa: referencia viva al look base.
5. Ajustes `warmth`/`exposure` **antes** del look; el resto después.

## 12. Fases

| Fase | Contenido | Sale con |
|---|---|---|
| F0 | Motor (`compileLook`, LUT 16F, worker latest-wins, LRU, mezcla única), legado separado, set de prueba, métricas, línea base de rendimiento | Pruebas de motor, hashes legado intactos, 3 looks piloto |
| F1 | Capa de look con Intensity + 8 ajustes, `adj` en estado/historial/sesión | Prueba de mezcla, de ajustes y de recursos |
| F2 | Catálogo por tandas (3–4 categorías por tanda), hojas de contactos, subpestañas, categorías y buscador | Revisión de Java por tanda |
| F3 | My Looks v2 (rejilla, menú, Library), Favorites | Pruebas de persistencia y de la Library |
| F4 | Revisión final: §7 completo, §8 medido, `ARCHITECTURE.md`/`DECISIONS.md` (Tauri) al día, un `[build]` | Pre-release |

## 13. Implementación v1: diferencias con esta especificación

Lo que se hizo distinto al implementar, y por qué. El resto se implementó como está escrito arriba.

| Punto | Especificado | Implementado | Por qué |
|---|---|---|---|
| §4.1, §4.4 | Una LUT por (look, ajustes) | La LUT depende solo de `def.color` (clave `defKey`). Los 8 ajustes son uniforms del pase `look`: exposición y temperatura antes de la LUT (con hombro suave en 0.82), el resto después en OKLab. | Arrastrar un ajuste no construye ni sube ninguna LUT; la caché solo guarda una LUT por look. |
| §4.1 `gamut` | Rodilla suave | Recorte de croma que conserva tono y luminosidad, con rodilla al 90 % del límite (`KNEE`); los colores dentro de ese 90 % no cambian. | Una rodilla aplicada a todo cambiaba colores ya válidos; un recorte duro aplanaba zonas saturadas. |
| §3.1 `skin` | Protege de hsl, zonas e input | También del balance de blancos del look, porque la piel se detecta en la entrada. La ventana es plana a ±22° de 52° y llega a 0 a ±48° en OKLCh. Las zonas usan la protección al cuadrado. | Con la ventana coseno de ±25° la piel real (30°–75°) se teñía. |
| §3.1 `zones` | Desplazamiento fijo | El tinte escala con la luminosidad (`L/0.55`). | Un desplazamiento fijo inundaba de color las fotos oscuras. |
| §3.1 `tone.contrast` | En dominio logarítmico | Positivo: potencias alrededor del pivote. Negativo: una cúbica que vale 0 en los extremos. | Una potencia menor que 1 tiene pendiente infinita en el negro y salían escalones. |
| §3.1 `lut` | `.cube` propio por look | No implementado en v1; ningún look lo necesitó. | — |
| §3.1 `intent` | `crush`, `clip`, `mono`, `hueShift` | Se añade `skin`: el look tiñe la piel a propósito (Moonlight, Blue Hour, Expired, Peel-Apart). `hueShift` ya no exime de la métrica de piel. | Separa «gira primarios» de «tiñe la piel». |
| §7.2 recorte | Un canal a 0 o 255 | Píxel entero aplastado a negro (máximo ≤ 1.5/255) o quemado a blanco (mínimo ≥ 254.5/255), nuevos respecto al original. | Un canal en su límite es el borde de la rodilla de gamut y conserva el tono; en sombras es invisible. |
| §7.2 escalones | ≤ 2× el paso medio | ≤ 3.5 niveles de 8 bits sobre luminancia codificada. | El paso medio depende del rango (fade); en L de OKLab la raíz cúbica hacía saltar los primeros pasos de cualquier curva. |
| §7.2 distancia | Umbral fijado en F0 | ΔE OKLab medio ≥ 0.015 del par más cercano de cada categoría. | Fijado con el catálogo de v1. |
| §4.2 grano | Grano del look | El pase de grano acepta `shadows` (0 = el grano de Tools sin cambios); el ajuste Grain escala el grano del look o añade uno. | El grano de película pesa más en sombras. |
| §2.1 | Clic en tile | La tile muestra la miniatura entera; `+`, `−` y el menú están en una esquina. | Los botones centrados tapaban la miniatura y recibían el clic. |
| §2.1, §4.5 | Clic sustituye, `+` apila, contador ×N | Clic = preview sin capa; `Add to layers` / doble clic añade una capa; ✓ sin contador; sin `+` / `−`; miniaturas del look solo. | Java (2026-10-13): «¿es preview o no es preview?», y añadir uno creaba dos capas. |
| §2.3 | Pestaña Mine | En inglés se llama «Saved». | No confundirla con My Looks. |
| §3.1 | Campos de `color` | Se añade `map`: mapa de degradado en OKLab (`stops` [posición, color], `amt` mezcla de color, `tone` cuánto sigue la luminosidad al mapa). Va tras zonas y antes de fade. | Looks de diseño (covers, miniaturas) que recolorean la imagen por tonos sin pintarla de un solo color. |
| §3.1 `intent` | — | Se añaden `creative` (looks de diseño: exentos de piel, primarios, inversiones y escalones de la rampa; deben conservar ≥ 35 % del abanico de tonos), `duotone` (impresión a dos tintas declarada: exenta del abanico de tonos) y `selective` (color selectivo). | Java (2026-10-13): looks intensos como diseño creativo marcado, nunca una capa de un solo color salvo duotonos declarados. |
| §7.2 | — | Métricas nuevas: fuerza (ΔE OKLab medio) y abanico de tonos conservado (≥ 60 %; 35 % en `creative`). | Medir que los looks difieran de verdad y que ninguno lave la imagen de un color. |
| §4.2 | Orden de acabados | `FINISH_ORDER`: óptica (sharpen, blur, edgeblur, motion, ghost, chroma, rgbshift), luz (halation, bloom, glow, glints, leak), vignette, impresión (pixelate, halftone, scanlines) y superficie (grain, dust). | Los looks creativos combinan pases de varias familias. |
| §3.5, §6 | Los 38 looks clásicos se ocultan y renderizan byte a byte igual | Eliminados del todo (código, textos y 38 de los 42 hashes de `grader-lut-baseline.json`; quedan las 4 muestras de Adjust y Gradient map). Un look clásico en trabajo guardado se abre como su look más cercano del catálogo (`CLASSIC`). | Java (2026-10-13): «no quiero ni uno de esos ya que están mal hechos». |
| §5 | 14 categorías | 15: se añade Mood (azules de noche, cian, violeta, tinta azul, rojo sobre negro), a partir de referencias de Java. | Petición de Java con moodboards. |
