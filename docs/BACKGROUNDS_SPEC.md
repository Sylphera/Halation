# Fondos propios: Drape reescrito y nuevo fondo de Welcome

> Estado (13-10-2026): Auralis v3 (hoy Drape) aprobado visualmente por Java (vídeo lado a lado) e integrado en `app/dist/drape.js`:
> superficie de seda por deformación de dominio, grain del fondo anterior al 50 %. v1 y v2 (pliegues) se descartaron.
> La migración a este repo es total: la próxima release sale de aquí y Halation-source se elimina.

Requisito para abrir el código (`docs/OPEN_SOURCE.md`). Los dos fondos actuales parten de componentes de 21st.dev sin
licencia: Auralis (Aman Shakya) y Aurora Veil (Isaiah Bjork). Auralis se reescribe con código propio (hoy Drape) y el mismo
aspecto; Welcome recibe un fondo nuevo y distinto.

## Procedimiento (sala limpia)

- El thread que implementa **no abre** `app/background/auralis.tsx`, `app/background/source-integrity.json`,
  `app/dist/welcome-background.js`, `app/dist/atmosphere.js` (los lleva compilados) ni `app/dist/auralis-renderer.js`
  (recorta y reutiliza el texto del shader original), ni el historial de git de esos archivos. Trabaja con esta especificación y con fotogramas de referencia del fondo
  actual, generados antes de empezar por otra sesión y guardados en `/mnt/project-files/backgrounds/ref/`
  (`auralis-<ancho>x<alto>-t<segundos>s.png`, capturados en tiempo real a 1, 5, 10, 20, 30 y 60 s).
- Sí puede leer el código propio de Halation que rodea a los fondos: `navigation-refraction.js`,
  `tool-atmosphere.js`, `soft-light.js`, `mount.tsx` (integración), `render-budget.js`, `motion.js`, y los tests.
- El ruido simplex se toma de una implementación con licencia permisiva citada en `THIRD_PARTY.md` (p. ej. la de
  Stefan Gustavson / Ashima Arts, MIT). La textura de blue noise se genera de nuevo con un script propio
  (void-and-cluster, 128×128) que se guarda en `app/scripts/`.
- Al terminar se borran `auralis.tsx`, `source-integrity.json`, la dependencia de React y su `atmosphere.js.LEGAL.txt`
  si dejan de usarse, y el código antiguo de `welcome-background.js`.

## 1. Drape (Home y fondo de la ventana)

### Lo que se ve (objetivo de paridad)

- Base casi negra con un matiz azul muy leve (≈ `#020203`).
- Haces de luz alargados en diagonal, ≈ 37° respecto a la horizontal, estirados a lo largo de su eje (unas 3 veces
  más largos que anchos). Se curvan despacio por una deformación de muy baja frecuencia (del orden de una pantalla),
  sin aparecer ni desaparecer de golpe.
- Dos tonos: un cuerpo gris azulado (`#5d6577`) a media intensidad que cubre buena parte de la pantalla, y crestas
  finas y más claras (`#b4c4f0`) dentro de los haces, más visibles donde hay cuerpo.
- Bolsas de vacío casi negras entre haces, grandes y lentas, que dan variación entre zonas.
- Campo "alejado": los fluidos son pequeños respecto a la ventana (equivale al zoom 1.6 actual).
- Movimiento lento y continuo en diagonal; la proporción de luz y vacío en pantalla se mantiene estable en el tiempo
  (el fondo no se apaga en ningún tramo).
- Viñeta suave hacia los bordes.
- Microtextura de grano fija (blue noise estacionario, sin warp ni cambio por fotograma; decisión del 2026-10-12),
  algo más fuerte en tonos medios, y dither de ±1 nivel de 8 bits contra el banding. Grano y dither en píxeles de
  pantalla 1:1.

### Cómo se pinta hoy (rendimiento, no aspecto)

- El campo de luz se calcula en un buffer pequeño (≈ 320 px de ancho, coma flotante de 16 bits si la GPU lo permite)
  a 15 Hz, y una pasada a tamaño nativo lo escala con filtrado lineal y añade dither y grano. La versión nueva puede
  seguir el mismo esquema o otro, siempre que cumpla el criterio 3.

### Contrato con el resto de la app (sin cambios)

- `window.__atmo` (mode, navigationWave, current, variant, toolReview) y los `data-` del host igual que hoy.
- Refracción de navegación (`navigation-refraction.js`) y escala de superficie leída del proxy `.drape-wave`.
- Transición Home ↔ herramienta (`tool-atmosphere.js`), opacidad y escala del host.
- DPR hasta 2 con canvas redondeado a píxeles; reloj con delta acotado a 0.1 s; `prefers-reduced-motion` como hoy.
- Parámetros: `colors` (3 hex, por defecto los de arriba), `speed` (1), `grain` (1.25).

### Implementación

- JavaScript plano en `app/dist/drape.js` (una sección por parte: shader, ruido, estabilizador, render), sin React
  ni bundler. `atmosphere.js` deja de ser un bundle; `app/background/` se reduce a lo que siga haciendo falta.

### Criterios de aceptación

1. Comparación lado a lado con las referencias a 1600×900 y 2560×1440, en t = 0, 10, 30 y 60 s y en un vídeo de
   20 s: Java no distingue cuál es cuál (OK visual explícito).
2. Luminancia media y proporción de píxeles por encima de un umbral dentro de ±5 % de la referencia en cada
   instante, y estables a lo largo de 60 s.
3. Coste de GPU igual o menor que el actual (`render-budget`), sin fotogramas largos nuevos.
4. Tests de fondo y de navegación en verde; los tests que comprobaban la integridad del archivo de 21st.dev se
   reemplazan por tests del comportamiento.

## 2. Welcome (fondo nuevo)

**Elegida: Cáusticas** (v3, aprobada por Java el 13-10-2026; prototipo en https://claude.ai/artifact/Kod3JRoJof23DJNoNiZGJd).
Reflejos amplios de luz plateada, como el agua en un techo: una red de líneas nítidas con un halo suave, charcos de
luz lentos, luz que cae desde arriba y una dispersión lavanda/cian muy leve. Ruido de valor de 3 octavas (más octavas
la convierten en rayos). Las primeras propuestas, descartadas por salirse de la estética de la app, eran:

| | Concepto | Qué se ve |
|---|---|---|
| **A (recomendada)** | **Halo** | Una fuente de luz fuera de foco, casi blanca, que respira despacio en el centro-arriba, con el borde rojizo-anaranjado del efecto de halación de la película (el nombre de la app) difuminándose hacia el negro. Grano fino encima. |
| B | Fuga de luz | Negro con grano; cada pocos segundos una fuga de luz cálida cruza lentamente un borde y se desvanece, como el final de un rollo. |
| C | Curvas de nivel | Líneas finas plateadas de un campo de ruido, como un mapa topográfico, que se deforman muy despacio. |

Común a las tres: la API `window.__welcomeBackground(canvas)` no cambia; 30 fps a través de `__renderBudget`; DPR y
límite de píxeles como hoy; con movimiento reducido, un fotograma fijo; colores de la luz tomados de `tokens.css`;
dither contra el banding. Aceptación: OK visual de Java en Welcome real (captura y vídeo de 10 s), sin coste de GPU
mayor que el fondo actual.

## Fuera de alcance

- Cambiar el diseño de Home, Welcome o la navegación; otros fondos (`tool-atmosphere`, `soft-light`).
- Los fondos de la app nativa Rust + Slint: la beta usa una atmósfera estática simple y no porta Drape ni Welcome;
  cualquier fondo animado futuro se especificará en el roadmap de `docs/SLINT_SPEC.md`.

## Orden

Un thread en High: 1) referencias del fondo actual (otra sesión), 2) Drape, 3) OK visual, 4) Welcome según la
opción elegida, 5) OK visual, 6) limpieza, `THIRD_PARTY.md` y tests. Entra en la rama de apertura; sin `[build]`
hasta que se decida la primera release tras abrir el código.
