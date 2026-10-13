# Library — Especificación v2

La Library como espacio común donde Halation organiza solo sus assets, presets, looks y exports para encontrarlos y
reutilizarlos. Guarda referencias, no copias, y se usa por búsqueda, recientes y favoritos antes que por carpetas.
Idea de Java: 2026-09-30. Parte de la Library de la 0.9.0 (`services.js` → libdata, `library.rs`, `libpanel.js`) y de
las pestañas arriba de la rama `claude/project-thread-fvshc6`.

---

## 0. Principios

1. **Índice, no explorador.** La Library es un índice de cosas útiles con su origen y su uso. Las carpetas son una
   fuente de datos más, no la forma de navegar.
2. **Referencias, no copias.** Un archivo con ruta se indexa donde está. Solo se escribe un archivo nuevo cuando no
   existe en disco (un resultado en memoria), y se escribe una vez, en su carpeta de destino normal.
3. **Automática.** Todo lo que produce una herramienta (export, descarga, captura, recorte, versión sin fondo,
   preset, look) entra en el índice sin que el usuario haga nada, con su herramienta de origen y de qué salió.
4. **Encontrar antes que ordenar.** Búsqueda, recientes y favoritos arriba; filtros por tipo y herramienta; las
   colecciones (carpetas propias, carpetas del PC, packs) debajo.
5. **Una Library para todo.** La misma vista y los mismos datos en la página Library, en el selector que abren las
   herramientas y en el "Send to…".

---

## 1. Qué hay hoy

- Página con cuatro pestañas (rama fvshc6): Library (secciones de imágenes y vídeos), Presets (Visualizer), Looks
  (Grade), Exports (lista `st.exports` de 40 entradas en `app.json`).
- Secciones: carpetas propias en `Documents\Halation\Library\<sección>`, carpetas del PC vinculadas (leídas en su
  sitio), packs de solo lectura y "★ Favourites" virtual. Estado `library`: `order`, `linked`, `favorites`, `tags`
  (por ruta).
- Descargas (`Downloads`), capturas (`Library\Frames`, `Exports\Frames`) y
  resultados de Upscale / Interpolate / Background Remover no están en la Library salvo como export reciente.
- Home copia a `Settings\Recent` los archivos abiertos de fuera de la carpeta de Halation (duplicado).

---

## 2. Distribución

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [All] [Assets] [Presets & looks] [Exports]                          ⟳  + Add     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 🔍 Search everything…                                     [Grid ▾] [Newest ▾]     │
│ Type: (Image)(Video)(Audio)(Font)(Preset)(Look)   Tool: (Grade)(Visualizer)(…)   │
├──────────────┬───────────────────────────────────────────────────────────────────┤
│ COLLECTIONS  │ RECENT                                                   See all → │
│ ★ Favourites │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢                                                    │
│ ─ Mine ─     │ FAVOURITES                                               See all → │
│ ▸ Covers     │ ▢ ▢ ▢ ▢ ▢ ▢                                                        │
│ ▸ Textures   │ ALL · 1 284                                                         │
│ ─ On this PC─│ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢                                                    │
│ ▸ D:\Arte    │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢                                                    │
│ ─ Packs ─    │ …                                                                   │
│ ▸ Grain      │                                        ┌─ DETAIL (al seleccionar) ┐│
│ + Collection │                                        │ nombre, tipo, tamaño      ││
│ ⊕ Link folder│                                        │ From: Grade · 2 h ago     ││
│              │                                        │ Made from: cover.jpg →    ││
│              │                                        │ Used in: Visualizer ×3    ││
│              │                                        │ Tags  [+]                 ││
│              │                                        │ [Open in ▾] [Send to…] ★  ││
└──────────────┴────────────────────────────────────────┴──────────────────────────┘
```

- **Pestañas arriba** (patrón de la rama): All, Assets, Presets & looks, Exports. Una pestaña es un filtro de tipo
  predefinido sobre el mismo índice; la búsqueda y los chips se combinan con ella.
- **Barra de búsqueda** siempre visible, con foco al entrar (`/` o Ctrl+F la enfoca). Chips de tipo y de herramienta
  debajo; orden (más nuevo, más usado, nombre) y vista (cuadrícula, lista).
- **Sin búsqueda ni filtro:** tres bandas: Recent (últimos 24 añadidos o usados), Favourites, y el resto en
  cuadrícula. **Con búsqueda:** una sola cuadrícula de resultados, por relevancia.
- **Collections** a la izquierda, plegable (recordado): Favourites, colecciones propias, carpetas del PC vinculadas,
  packs. Al elegir una, la cuadrícula muestra su contenido con los mismos filtros.
- **Detalle** a la derecha al seleccionar un elemento: metadatos, origen ("From: Grade"), de qué salió ("Made
  from"), dónde se usó, etiquetas, acciones (abrir en una herramienta, Send to…, favorito, mostrar en carpeta,
  Crop copy, Add cutout version, quitar de la Library).
- **Presets & looks:** presets del Visualizer y looks de Grade (propios e incluidos) y
  lo que añadan herramientas nuevas. Miniatura propia de cada tipo (la del look sobre una imagen de muestra, la del
  Visualizer sobre su portada). "Apply" abre la herramienta con él aplicado.
- **Exports:** todo lo que las herramientas han escrito en `Exports` y `Downloads`, sin límite de 40, agrupado por día.
- **Selector** (`libpanel.js` en modo picker): la misma vista sin columna de colecciones, con el filtro de tipo que
  pide la herramienta fijado.
- **Selección múltiple:** casilla en cada tarjeta, como hoy en Exports: Send to…, favorito, etiquetar, quitar.

### 2.1 Tarjeta

Miniatura, nombre, un distintivo de tipo y el icono de la herramienta de origen; estrella al pasar el ratón; aviso
"Missing" si el archivo ya no está. Un clic selecciona (detalle), doble clic abre en la herramienta por defecto del
tipo, arrastrar lleva el archivo a una herramienta o fuera de la app.

---

## 3. Modelo de datos

Índice en `Settings\Library\index.json` (escritura atómica, un archivo; si pasa de 20 000 elementos se parte por
tipo). Miniaturas en `Tools\cache\library` (ya existe; pasa a ser parte del workspace, JOBS_SPEC §6).

```json
{
  "version": 2,
  "items": [{
    "id": "i_8f3a…",
    "type": "asset",
    "kind": "image",
    "path": "D:\\Arte\\cover.jpg",
    "fileKey": "vol:3A1F-00A2|idx:0x0001000000012C4E",
    "name": "cover.jpg",
    "size": 2381221, "mtime": 1790000000000,
    "meta": { "w": 3000, "h": 3000, "alpha": false, "dur": null, "fmt": "jpeg" },
    "origin": { "tool": null, "job": null, "from": [] },
    "addedAt": 1790000000000, "usedAt": 1790000500000, "uses": 3,
    "usedIn": { "visualizer": 2, "grade": 1 },
    "fav": true, "tags": ["cover", "2026"],
    "collections": ["c_covers"],
    "missing": false
  }],
  "collections": [
    { "id": "fav", "kind": "fav" },
    { "id": "c_covers", "kind": "own", "name": "Covers", "path": "…\\Library\\Covers" },
    { "id": "c_d_arte", "kind": "link", "name": "Arte", "path": "D:\\Arte" },
    { "id": "c_grain", "kind": "pack", "name": "Grain", "path": "…\\Library\\Packs\\Grain" },
    { "id": "c_mix", "kind": "virtual", "name": "Single June" }
  ],
  "order": ["fav", "c_covers", "c_d_arte", "c_mix"]
}
```

- **`type`:** `asset` (lo que el usuario trae o guarda), `preset`, `look`, `export`, `download`.
- **`kind`:** `image`, `video`, `audio`, `font`, `logo`, `preset-visualizer`, `look`.
- **`fileKey`:** identidad del archivo en Windows (número de serie del volumen + índice del archivo, de
  `GetFileInformationByHandle`), para seguirlo si se renombra o se mueve dentro del mismo volumen. Sin él (otro
  sistema de archivos), la ruta.
- **`origin`:** herramienta y trabajo que lo produjeron (id del job, JOBS_SPEC §3) y los `id` de los elementos de
  los que salió (una versión sin fondo apunta a su original; un export del Visualizer, a su cover y su audio).
- **Colecciones:** `own` (carpeta de `Library`: añadir a ella mueve o copia según §4), `link` (carpeta del PC, leída
  en su sitio), `pack` (solo lectura), `virtual` (solo referencias, ningún archivo se mueve), `fav`.
- Un elemento puede estar en varias colecciones virtuales. Etiquetas y favoritos van por `id`, no por ruta.

### 3.1 API (`window.__hal.library`)

`query({ text, types, kinds, tools, collection, sort, limit, offset })` → `{ items, total }` ·
`get(id)` · `add(pathOrBlob, { type, kind, origin, collection, name })` → item · `touch(id, tool)` (uso) ·
`setFav(ids, on)` · `setTags(ids, tags)` · `remove(ids)` (del índice; nunca borra el archivo salvo en `own` con
confirmación) · `locate(id, path)` · colecciones: `createCollection`, `renameCollection`, `removeCollection`,
`linkFolder`, `addTo(collection, ids)` · evento `library` con `{ changed: [ids] }`.
Se mantienen `sections`, `items`, `toggleFav`, `setTags`, `version` y `poll` como envoltorios de lo anterior mientras
quede código que los use.

Rust (`library.rs`): `library_index_get`, `library_index_put`, `library_scan` (una carpeta → entradas con `fileKey`,
tamaño, mtime), `library_resolve` (busca por `fileKey` en las carpetas conocidas lo que falta), `library_watch`.

---

## 4. Referencias y cuándo se escribe un archivo

| Situación                                          | Qué pasa                                                   |
|----------------------------------------------------|------------------------------------------------------------|
| Añadir desde el PC (arrastrar, "+ Add")            | Referencia en su sitio. Nada se copia.                     |
| Vincular una carpeta del PC                        | Se indexa en su sitio y se vigila.                         |
| Resultado sin archivo (Crop copy, cutout, captura) | Se escribe una vez en su carpeta de salida (`Exports\…`, `Library\Frames`) y se indexa con `origin`. |
| Export o descarga de una herramienta               | Ya existe en `Exports` / `Downloads`: se indexa, no se copia. |
| Añadir a una colección `own`                        | Elemento de dentro de `Documents\Halation`: se mueve. De fuera: pregunta "Move" / "Copy" / "Just reference" (defecto: Just reference → colección virtual). |
| Home, archivos recientes                           | Referencia al elemento de la Library; se elimina `Settings\Recent`. Si el archivo original desaparece, el reciente se marca Missing. |
| Una herramienta abre un archivo                    | `touch(id, tool)`: sube en Recent y en "Used in".          |

- Un archivo que desaparece queda como Missing (miniatura en gris, "Locate…"). Al arrancar y cada vez que una
  carpeta vigilada cambia, `library_resolve` intenta encontrarlo por `fileKey`.
- Quitar de la Library nunca borra un archivo de una carpeta vinculada ni de fuera de Halation.

---

## 5. Búsqueda, recientes y favoritos

- **Búsqueda:** en el índice en memoria de la página principal, sin llamar al disco. Coincide por nombre, etiquetas,
  tipo, herramienta de origen, colección y nombre del original ("Made from"). Palabras en cualquier orden,
  prefijos, sin acentos ni mayúsculas. Filtros escritos: `type:look`, `tool:grade`, `is:fav`, `is:missing`,
  `today`, `week`.
- **Relevancia:** coincidencia exacta del nombre > prefijo > etiqueta > resto, y a igualdad, favorito y uso reciente.
- **Recientes:** `max(addedAt, usedAt)` descendente; 24 en la banda, todos en "See all".
- **Favoritos:** por `id`, sobre cualquier tipo (un look, un preset, un export, una textura).
- **Home:** su búsqueda puede consultar `library.query` para mostrar resultados de la Library debajo de los de
  herramientas (opcional en v2, ver §8).

---

## 6. Parámetros y valores por defecto

| Parámetro                         | Defecto          | Notas                                            |
|-----------------------------------|------------------|--------------------------------------------------|
| Pestaña al entrar                 | All              | Se recuerda la última                            |
| Vista                             | Grid             | Grid / List                                      |
| Orden                             | Newest           | Newest / Most used / Name                        |
| Recent (banda)                    | 24               |                                                  |
| Tamaño de miniatura               | 320 px lado mayor| WebP, en `Tools\cache\library`                   |
| Añadir a colección propia desde fuera | Just reference | Move / Copy / Just reference                   |
| Exports indexados                 | sin límite       | los de `Exports` y `Downloads`                   |
| Columna Collections               | abierta ≥ 1100 px de ancho | plegada por debajo                     |

---

## 7. Integración

- **Herramientas:** al terminar un trabajo que escribe un archivo, el sistema de jobs llama a `library.add` con
  `origin` (JOBS_SPEC §3, `onDone`). Las herramientas dejan de llamar a `recordExport` directamente.
- **Escaneo e índice de miniaturas:** trabajos de fondo del sistema de jobs (`kind: "index"`, prioridad baja), sin
  entrada visible en la bandeja salvo que duren más de 10 s.
- **Send to…:** acepta elementos de la Library por `id`; el destino recibe `{ kind, name, path, meta, libraryId }`.
- **Migración (una vez):** `library.favorites` y `library.tags` (por ruta) pasan a `id`; `library.order` y
  `library.linked` a `collections`; `st.exports` a elementos `export`; presets de `Presets\*` y looks propios se
  indexan; `Settings\Recent` se convierte en referencias cuando el original existe y se borra.

---

## 8. Criterios de aceptación

1. Un export de cualquier herramienta aparece en Exports y en Recent en menos de 1 s tras terminar, con miniatura,
   icono de la herramienta y "Made from" cuando tiene origen.
2. Añadir 200 imágenes desde una carpeta del PC no crea ningún archivo en `Documents\Halation` (solo índice y
   miniaturas).
3. Renombrar o mover (mismo disco) un archivo indexado desde el Explorador conserva favorito, etiquetas y usos.
4. Un archivo borrado se ve Missing; "Locate…" lo reconecta.
5. Búsqueda sobre 20 000 elementos: resultados en menos de 50 ms por pulsación (medido en el test).
6. Favoritos mezcla tipos (un look, un preset y una imagen a la vez) y se puede filtrar por tipo.
7. El selector de una herramienta muestra solo los tipos que acepta y abre en Recent.
8. La migración desde la 0.9.0 conserva favoritos, etiquetas, orden y carpetas vinculadas; `Settings\Recent`
   desaparece sin perder recientes cuyo original existe.
9. Todo texto nuevo en `en.json`; animaciones con `motion.js` (`list` para la cuadrícula, `enter` para el detalle,
   skeletons mientras llegan miniaturas).
10. Tests: `tests/library.js` ampliado (índice, referencias, migración, Missing, búsqueda con tiempo), `host.js`
    replica los comandos nuevos, `cargo test` para `fileKey` y `library_resolve`.

---

## 9. Fuera de alcance

- Etiquetado automático por contenido (IA, colores dominantes).
- Deduplicación por contenido de archivos distintos con los mismos bytes.
- Edición de metadatos dentro de los archivos (EXIF, ID3).
- Sincronización o compartir colecciones (sin nube).
- Papelera propia: borrar va a la papelera de Windows.
- Proyectos completos (sesión de una herramienta) como elementos: posible en una v3.

## 10. Decisiones abiertas (valor por defecto elegido)

- Índice en un JSON (elegido) frente a SQLite: JSON basta hasta decenas de miles de elementos y no añade
  dependencias; SQLite si la Library crece más.
- Resultados de la Library dentro de la búsqueda de Home: fuera de v2, entra si Java lo pide.
