# Cover Test — Especificación v1

Herramienta para ver una portada o miniatura propia dentro de YouTube, Spotify y SoundCloud, rodeada de contenido
real de cada plataforma, antes de publicarla. Plan de Java del 2026-09-27 (prompt 7 + perfil de artista + banner y
rendimiento), del 2026-09-30 (bienvenida con un solo dato) y su revisión del 2026-09-30 (página del artista en cada
plataforma, "a distancia" como navegador ancho, subida de covers más clara, referencias de otros artistas; fuera Up
next y Now playing). Nombre de la herramienta pendiente (§11); en el código,
`covertest`.

---

## 0. Principios

1. **Plantillas propias, contenido real.** Cada vista se recrea en HTML/CSS local (medidas, radios, tipografía,
   claro/oscuro fieles a la plataforma). Nunca se carga ni se copia el HTML de las páginas. Lo real es lo de
   alrededor: releases del perfil del usuario y contenido público de cada plataforma.
2. **Tamaño real.** Cada vista se dibuja a los píxeles CSS que usa la plataforma (sin escalar), con opción "a
   distancia" para juzgar la legibilidad.
3. **Local y en caché.** Todo lo leído de la red se guarda en disco (WebP reducido). Sin red, el último caché.
   La red nunca bloquea la vista: se pinta lo que hay y se refresca en segundo plano.
4. **Solo metadatos públicos.** Sin login, sin claves de API, sin audio de Spotify.

---

## 1. Distribución de la pestaña

```
┌──────────────────┬──────────────────────────────────────────────────┬─────────────────┐
│ YOUR COVER       │ [YouTube] [Spotify] [SoundCloud]                 │ DATOS           │
│ ┌─────────────┐  │ Vista: Channel · Home · Search · Mobile          │ Title    [____] │
│ │ Upload your │  │ ┌──────────────────────────────────────────────┐ │ Artist   [____] │
│ │ cover here  │  │ │                                              │ │ Views   [1,2 M] │
│ └─────────────┘  │ │   plantilla de la plataforma a tamaño real   │ │ Duration [3:12] │
│ (con covers: una │ │   con tu cover entre contenido real          │ │ Date   [2 days] │
│  fila por cover: │ │                                              │ │ Position ▾      │
│  elegir, recortar│ └──────────────────────────────────────────────┘ │                 │
│  quitar; Upload  │ ◐ tema   ◉ A distancia                           │ Feed [query___] │
│  another)        │                                                  │ Export PNG ▾    │
│ PERFIL           │                                                  │                 │
│ REFERENCES (≤4)  │                                                  │                 │
└──────────────────┴──────────────────────────────────────────────────┴─────────────────┘
```

- Sin cover: "Upload your cover here" en la tarjeta y en el escenario (archivo, soltar, Library, Send to…). Con
  covers: una fila por cover (clic o 1 · 2 · 3 para elegirlo, recortar, quitar) y "Upload another" hasta 3.
- Teclas 1, 2, 3 cambian el cover activo; la vista se actualiza al instante.
- La columna central hace scroll si la vista es más alta que la ventana (como la página real).

---

## 2. Vistas

| Plataforma | Vista | Medidas de referencia (px CSS) | Dónde va tu cover |
|---|---|---|---|
| YouTube | Channel (página del artista) | banner 6,2:1 radio 16, avatar 160, nombre 36/700, pestañas, rejilla de vídeos 16:9 (columnas de 360 mín., 1284 máx.) | el vídeo nuevo entre los suyos (posición 1–6) |
| YouTube | Home (grid) | miniatura 16:9, 360 × 202 en 1440 de ancho (4 columnas), radio 12, avatar 36 | una celda (posición elegible), resto real |
| YouTube | Search | miniatura 500 × 281 (máx.), radio 12, avatar 24 | primer, segundo o tercer resultado |
| YouTube | Mobile | 390 de ancho, miniatura a todo el ancho, radio 0 | un elemento del feed |
| Spotify | Artist (página del artista) | cabecera con su banner (390 de alto, nombre 96/800) o, sin banner, su foto 232 redonda sobre el color de la portada; Popular (miniatura 40), Artist pick (88), Discography (156) | Popular (posición 1–5), Artist pick y primera de Discography |
| Spotify | Release | portada 232 × 232, radio 4, sombra, cabecera con degradado del color de la portada | cabecera |
| Spotify | Home row / Release Radar | tarjeta 180, portada 164 × 164, radio 6 | una tarjeta de la fila |
| SoundCloud | Profile (página del artista) | banner 260 de alto, avatar 200 redondo, nombre en caja negra, pestañas, pistas con artwork 160 y onda; columna de 1240 | una pista entre las suyas (posición 1–4) |
| SoundCloud | Track | artwork 340 × 340, cabecera con degradado, forma de onda | cabecera |
| SoundCloud | Feed | artwork 160 × 160, onda, avatar 40 | un elemento del stream |

- Superposiciones propias: duración en la esquina (YouTube), barra roja de progreso opcional (YouTube, "visto a
  medias"), redondeos de Spotify, forma de onda y contador de reproducciones (SoundCloud).
- Tipografías: YouTube Roboto; Spotify y SoundCloud una sans del sistema equivalente (sin empaquetar fuentes
  propietarias). Se usan fuentes libres ya incluidas o del sistema.
- Tema claro/oscuro por plataforma (YouTube ambos; Spotify solo oscuro, como la app; SoundCloud ambos).
- Cada plataforma abre en la página del artista (su canal, su perfil): cómo queda el lanzamiento nuevo entre los
  suyos, con su banner, avatar y releases del perfil (§4).
- "A distancia": la página maquetada para una pantalla de 1920 × 1080 dentro de una ventana de navegador (pestaña
  con el título de la página, barra de dirección con su URL) y reducida hasta caber en el escenario. No solo más
  pequeña: con el espacio de una pantalla ancha aparece todo lo de alrededor (más columnas, la guía lateral de
  YouTube desde 1312 px, la columna de 1240 de SoundCloud centrada). La vista normal sigue a tamaño real. El
  export es la página que se ve (en "a distancia", la de 1920 de ancho). La vista móvil se muestra entera, reducida.

---

## 3. Tus datos

- Hasta 3 covers: imagen propia (PNG, JPG, WebP). Se recorta con el servicio Crop al ratio de la vista (16:9
  YouTube, 1:1 Spotify y SoundCloud) si no lo tiene; el recorte se guarda como parámetros y se reedita.
- Campos: Title, Artist (por defecto el nombre del perfil), Views (por defecto `1,2 M`), Duration (`3:12`), Date
  (`2 days ago`). Un solo juego de campos para los 3 covers (el test compara imágenes, no textos).
- Position: dónde cae tu cover en la vista (vídeo 1–6 en Channel, celda 1–8 en Home, resultado 1–3 en Search,
  canción 1–5 en Artist, pista 1–4 en Profile…).
- References: hasta 8 artistas por enlace o nombre (§5.1).
- Se guarda el último estado de la pestaña (covers, campos, vista) y se recupera al volver.

---

## 4. Perfil de artista (servicio compartido, `window.__hal.profile`)

Lo usa esta herramienta y la pantalla de bienvenida (thread "Home, fondo, Settings y Library").

### 4.1 Flujo (Java, 2026-09-30)
1. Bienvenida (primera apertura, se puede saltar): se pide **un solo dato**, un enlace o un nombre.
2. Con ese dato se busca en las otras dos plataformas. Por cada candidata: "¿Es este tu enlace / tu nombre?"
   con avatar, nombre y seguidores; sí o no. Solo la primera vez.
3. Después, en Settings y en esta herramienta: un botón **"Search other platforms"** y edición manual.
- Una sola entrada: la identidad (nombre y enlaces) vive en los ajustes (`settings.artistName`, `settings.links`) y
  la edita Settings → Artist (`shell.js`: `findProfiles`, `findLinks`, diálogo "Are these yours?"). `findProfiles`
  usa primero `__hal.profile.search` (lectores de plataforma, candidata con parecido ≥ 0,6) y la búsqueda web
  (Bing, DDG) solo como respaldo. Este servicio guarda lo leído de esos enlaces, no los enlaces.

### 4.2 Búsqueda (`search`, `findOthers`)
- Desde un enlace: se extrae el perfil de esa plataforma y sus enlaces cruzados (SoundCloud lista sus perfiles
  web; YouTube, los enlaces del canal). Un enlace cruzado es la candidata más fiable.
- Desde un nombre, o para las plataformas que falten:
  - YouTube: página de resultados con filtro de canales (`ytInitialData`).
  - SoundCloud: `api-v2` `search/users` con el `client_id` público de su web.
  - Spotify: enlaces cruzados; si no hay, MusicBrainz (`url-rels`) y, en último lugar, una búsqueda web del
    enlace `open.spotify.com/artist/…`. Spotify no tiene búsqueda pública sin clave.
- Hasta 3 candidatas por plataforma, ordenadas por parecido de nombre y seguidores.

### 4.3 Extracción (`refresh`)
| Plataforma | Nombre y avatar | Banner | Últimas 10 releases |
|---|---|---|---|
| YouTube | `og:title`, `og:image` / cabecera de `ytInitialData` | banner de la cabecera | pestaña `/videos` (`ytInitialData`): id, título, vistas, fecha, duración, miniatura |
| Spotify | página del artista (`og:*`) y embed (`__NEXT_DATA__`) | `headerImage` del embed o del estado propio de la página (`<script id="initialState">`, JSON en base64); sin él, su foto sobre el color de la portada | lista del embed del artista (sus canciones más escuchadas, no las últimas: Spotify no da más sin clave) + portada por oEmbed |
| SoundCloud | `__sc_hydration` de la página del perfil | `visuals` del perfil | `api-v2` `users/<id>/tracks` |

- Peticiones en paralelo, cabeceras de navegador y cookie de consentimiento (YouTube en la UE).
- Cada imagen se reduce al tamaño máximo de su uso y se guarda en WebP: avatar 176, cover/miniatura 336
  (YouTube 336 × 189), banner 1280 de ancho. Calidad 0,82.
- Si una plataforma falla, se conserva lo anterior y se marca con la hora del último dato bueno.

### 4.4 Modelo de datos
`Settings\Profile\profile.json`, imágenes en `Settings\Profile\*.webp`:

```json
{
  "v": 1,
  "name": "Artist",
  "platforms": {
    "youtube": {
      "link": "https://www.youtube.com/@artist", "url": "…", "id": "UC…", "name": "Artist",
      "avatar": "youtube-avatar.webp", "banner": "youtube-banner.webp",
      "followers": 12400, "fetched": 1759219200000, "error": "",
      "manual": { "name": null, "avatar": null },
      "releases": [{ "id": "…", "title": "…", "url": "…", "image": "youtube-r-….webp",
                     "views": 5120, "date": "2026-09-01", "duration": 192 }]
    },
    "spotify": { … }, "soundcloud": { … }
  },
}
```

- `link`: el enlace de los ajustes con el que se leyó; si el enlace cambia, la plataforma se vacía hasta el próximo
  refresco.
- `manual` gana a lo extraído y sobrevive a "Update from my page".
- Las covers de la herramienta se guardan en la misma carpeta (`cv-0..2.webp`).

### 4.5 API
- `get()` → perfil (instantáneo, desde disco) con las imágenes como URL. `image(area, file)` → URL de una imagen en
  caché. `size()` → bytes en disco.
- `search(text, skip?)` → `{ source, candidates: { youtube: [], spotify: [], soundcloud: [] } }`; `text` puede ser
  enlace o nombre. Los enlaces se guardan con los ajustes (Settings → Artist, `__hal.findLinks`).
- `edit(platform, { name, avatar })`.
- `refresh(platforms?)` → en segundo plano; emite `profile` con `{ ms, bytes }` al terminar.
- `feed(platform, query)` → `{ items, fetched, error }` (§5).

---

## 5. Contenido real de alrededor (feed)

- YouTube: resultados de búsqueda de un texto ("Feed", por defecto el género o `new music`) → miniaturas, títulos,
  canales, vistas, fechas y duraciones reales.
- Spotify: una lista pública editorial (por defecto New Music Friday) por su embed → títulos, artistas y portadas
  (oEmbed por pista).
- SoundCloud: `api-v2` `search/tracks` con el mismo texto.
- Hasta 24 elementos por plataforma, imágenes en WebP reducidas, en `Tools\cache\covertest` (`yo-feed.json`,
  `yo-f-<id>.webp`, `yo-a-<id>.webp`; prefijo por plataforma) (cuenta en Settings →
  Storage y se borra con "Clear caches"). Se refresca en segundo plano si tiene más de 24 h; sin red, el último si es del mismo texto.
- Sin nada en caché y sin red: plantillas grises (skeleton) en lugar del contenido.

---

## 5.1 Referencias

- Hasta 4 artistas, por enlace (YouTube, Spotify o SoundCloud) o por nombre. Se leen con la misma búsqueda del perfil
  (`profile.js` `reference`): la plataforma del enlace, las de sus enlaces cruzados y, por nombre, una coincidencia
  segura (parecido ≥ 0,9); de cada plataforma, avatar y sus 2 últimos lanzamientos.
- En cada vista con contenido de otros (Home, Search, Mobile, Home row, Feed) va uno de cada artista junto al tuyo,
  antes del feed. En las páginas del propio artista no.
- Caché en `Tools\cache\covertest` (`rf-<hash>.json` y sus WebP), una semana; al quitar una referencia se borran
  sus archivos. Una que no se encuentra lo dice en su fila ("Not found on YouTube, Spotify or SoundCloud").

---

## 6. Export e integración

- Export PNG de la vista a su tamaño real (×2 opcional para nitidez), a `Exports\Covers`. Con "A distancia"
  activo, se exporta la página ancha (1920) sin la ventana del navegador.
- Send to… acepta `image` (desde Crop, Remove Background, Grade, Frame Capture, Upscale y la Library); entra como
  cover en la primera casilla libre (o sustituye el activo si las 3 están llenas).
- "Back to <origen>" no aplica (no devuelve imagen editada).

---

## 7. Rendimiento

- Perfil completo (3 avatares, 3 banners, 30 releases) < 5 MB en disco.
- Primera apertura con red: perfil y feed en < 3 s (peticiones en paralelo, las imágenes aparecen según llegan).
- Desde caché: vista pintada en el primer frame tras cargar la pestaña (< 300 ms).
- Cambiar de cover, de vista o de tema: < 1 frame de trabajo (sin reconstruir la vista entera).

---

## 8. Criterios de aceptación

1. Las 9 vistas se pintan con tu cover y contenido de caché; claro/oscuro donde aplica.
2. 3 covers, cambio con clic y con 1/2/3; los campos se reflejan en todas las vistas.
3. Perfil: enlace válido → nombre, avatar, banner y 10 releases; enlace inválido → aviso sin romper nada; sin red
   → caché; edición manual que sobrevive a "Update"; búsqueda de las otras plataformas con sí/no.
4. Export PNG con las medidas de la vista. Send to desde Crop y Remove Background.
5. Tamaño en disco y tiempo de carga medidos en el informe.

---

## 9. Fuera de alcance en la v1

- Instagram, TikTok, Apple Music, Bandcamp.
- Vídeo en movimiento en las vistas (hover preview de YouTube, Canvas de Spotify).
- Estadísticas o puntuación automática del cover (CTR estimado).
- Iniciar sesión en las plataformas o leer datos privados.

---

## 10. Riesgos

- Las páginas cambian: los extractores leen varias rutas y fallan en silencio a la última copia buena. Tests con
  páginas guardadas en `tests/` (sin red en la integración continua).
- Spotify no ofrece búsqueda por nombre sin clave; la búsqueda depende de enlaces cruzados y MusicBrainz.

---

## 11. Nombre

Propuestas (coherentes con Audio Visualizer, Grade, Downloader, Frame Capture, Motion Text):
- **Feed Preview** (recomendado): dice qué hace, sirve igual para miniaturas y portadas.
- Cover Check
- Shelf Test
- In the Wild
