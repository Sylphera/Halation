# Menú de procesos — Especificación v1

Status: Planned — not ported to the native app; implemented in the Tauri app on `main`.

## Dirección visual vigente — 2026-10-01

La instrucción más reciente del usuario sustituye las posiciones, bordes, frases y popover descritos abajo.
Las acciones de Jobs, accesibilidad, teclado, agrupación y cancelación siguen aplicándose.

- En reposo, un toolbox compacto y plano contiene visualmente los cuatro iconos (Processes, teclado, carpeta e idioma),
  sobre fondo opaco casi integrado con la barra y un único borde fino común. Processes no tiene píldora propia ni texto.
  Los cuatro iconos tienen la misma separación entre centros (36 px); toda su área de 36 × 28 px es pulsable. Settings permite ocultarlo; Ctrl+J conserva acceso sin detener Jobs.
- Instrucción vigente de Thread 1: en reposo Processes pertenece al toolbox completo, junto a teclado, carpeta e idioma.
  Con actividad conserva esa misma superficie y los otros controles; no se desprende una isla ni una píldora.
- Al clicar Processes (o Ctrl+J), todo el toolbox se transforma en el Process Manager: los otros controles se funden,
  Processes se centra y el mismo fondo se desplaza/crece para contener el cuerpo. El clic siguiente invierte la transformación.
  La geometría de cada objeto parte de su posición visual actual, también al invertir o cambiar Jobs durante el movimiento.
- El toolbox completo conserva su anclaje derecho; únicamente el manager solicitado se centra en la ventana.
  La restauración de los otros controles pertenece a la misma transformación; no aparece una segunda caja.
- Una sola marca de estado: reloj al esperar, arco al ejecutar, puntos al finalizar, tick al completar y alerta
  al fallar. Nombre corto conservando la extensión, porcentaje conocido cuando aporta información y una acción
  puntual. El título completo permanece accesible; etapa, error, ETA y recursos se leen en la parte expandida.
  No combinar brillo, anillo, barra y frases para explicar la misma actividad; no desplazar ni cortar nombres.
- La cabecera compacta y el cuerpo expandido pertenecen al mismo elemento y comparten el mismo fondo. La isla
  crece hacia abajo; no aparece una segunda ventana ni hay separación entre píldora y bandeja.
- Cambiar geometría una vez y animar solo `transform`/`opacity`, a través de `motion.js`: el fondo se transforma
  entre ambas geometrías y el contenido conserva su tamaño. Sin animar width, height, top, left, blur o sombras.
  Aperturas y cierres interrumpidos deben mantener continuidad y volver al mismo punto. Movimiento reducido:
  solo fundido breve, sin giros, pulsos ni escalas.
- La evidencia visual de la aplicación y el OK explícito del usuario siguen siendo compuertas de cierre.

El resto de este documento conserva el contexto funcional original; su presentación anterior no es autoridad
frente a esta dirección.

Un punto discreto abajo a la izquierda de la ventana que crece según lo que pasa (un trabajo que arranca, termina o
falla) y que al abrirlo despliega una bandeja pequeña con los trabajos activos, en cola y terminados: progreso,
orden, estado y cancelar, sin salir de la herramienta actual. Es la cara visible del sistema de jobs
(`docs/features/jobs.md`). Ideas de Java: 2026-09-30 (el punto que se expande y el menú de procesos, unidas aquí en un
solo elemento).

---

## 0. Principios

1. **Discreto en reposo.** Sin trabajos, un punto apagado que no pide atención.
2. **Crece con lo que pasa.** El punto se estira en una píldora con una línea cuando algo cambia y vuelve a punto
   solo. Nada de ventanas ni diálogos por un trabajo.
3. **Controlar sin salir.** Todo lo que se hace con un trabajo (ver, reordenar, cancelar, abrir el resultado) se hace
   desde la bandeja, encima de la herramienta actual.
4. **Una sola fuente.** Lo que muestra sale de `__hal.jobs`; no guarda estado propio salvo si la bandeja está abierta.
5. **Lanzar y seguir.** Mandar algo a la cola no bloquea nada: la herramienta queda libre al instante para seguir
   editando, cargar otro archivo o ir a otra herramienta. Ninguna barra de progreso modal, ningún botón deshabilitado
   por un trabajo en marcha.

### 0.1 Recomendación: tres capas, de menos a más

Para que sea "tan fácil como respirar", el usuario no debería tener que abrir nada en el uso normal:

1. **En el sitio donde se lanza** (siempre): el botón confirma en el acto ("Queued · 2nd" o "Started") y una
   miniatura vuela del botón al punto. Así se aprende sin explicación dónde ha ido el trabajo. Es lo único que se ve en
   la herramienta.
2. **El punto y su píldora** (siempre): el anillo dice que algo corre; la píldora avisa cuando termina con "Open" a
   un clic. Cubre casi todo el uso: lanzar, seguir trabajando, abrir el resultado.
3. **La bandeja** (solo al pedirla): para reordenar, cancelar o ver un lote. Compacta: por defecto enseña lo que corre
   y lo que espera; lo terminado queda plegado en una línea ("3 finished").

La notificación de Windows solo cuando la ventana no está a la vista (otra app delante o minimizada). Una barra de
trabajos fija en pantalla o un panel lateral quedan descartados: ocupan sitio siempre para algo que se mira pocas
veces.

---

## 1. Posición

- La barra de herramientas (rail) es vertical, centrada a la izquierda. El punto vive en la misma columna, abajo,
  centrado en el eje del rail, a 16 px del borde inferior. Pertenece a la ventana principal (`index.html`) y queda
  por encima de las páginas de herramientas, igual que el rail.
- En Home también está (el mismo sitio), por encima de la atmósfera.
- Los avisos (`toast`) de trabajos pasan al punto; el resto de avisos sigue abajo al centro como hoy.

---

## 2. Estados del punto

```
 reposo          actividad            evento (píldora)                          abierto
   ·               ◔ 2              ●──────────────────────────────╮           ● ▸ bandeja
 6 px, apagado   anillo de progreso  │ ✓ cover.mp4 exported   Open  │ 4 s       (§3)
                 + número si > 1     ╰───────────────────────────────╯
```

| Estado     | Cuándo                                   | Aspecto                                                              |
|------------|------------------------------------------|----------------------------------------------------------------------|
| Reposo     | sin jobs en cola ni en marcha            | punto de 6 px, color `--line`, sin brillo                            |
| Actividad  | uno o más jobs en marcha o en cola       | punto de 10 px con el color de acento y un anillo con el progreso total (media ponderada de los jobs con progreso conocido; indeterminado: arco que gira despacio); número de jobs al lado si hay más de uno |
| Espera     | todo lo que hay está `waiting` o `held`  | como actividad, anillo en gris                                       |
| Evento     | un job arranca (solo si se lanzó desde otra vista), termina, falla o queda esperando por un recurso más de 3 s | el punto se estira hacia la derecha en una píldora de una línea: icono de estado, título, verbo ("exported", "downloaded", "failed", "waiting for GPU") y una acción ("Open", "Retry", "Show"). Vuelve a punto a los 4 s, o al quitar el ratón si estaba encima |
| Abierto    | clic en el punto o en la píldora, Ctrl+J | el punto se queda y la bandeja sale de él                            |

- Varios eventos seguidos no se apilan: la píldora cambia su texto al último, y los que no se vieron quedan en
  Finished.
- Un fallo deja el punto con un borde rojo (`--danger`) hasta abrir la bandeja.
- Con la ventana sin foco, al terminar un job sale además la notificación de Windows (Settings → "Notify when a job
  finishes").

---

## 2.1 Lanzar y seguir trabajando

- **Instantánea al lanzar:** el job copia en el momento de `submit` todo lo que necesita (proyecto, ajustes, capas,
  archivos de entrada por referencia), como hoy hace el Visualizer con `frozenR`. Lo que el usuario cambie después no
  afecta al trabajo en cola ni al que corre.
- **Confirmación en el botón:** el botón que lanzó el trabajo cambia un momento su texto ("Queued · 2nd", "Started")
  y vuelve a su estado normal a los 1,5 s, listo para lanzar otro. Una miniatura (o el icono de la herramienta)
  vuela del botón al punto por el resorte de `motion.js` (movimiento reducido: sin vuelo, solo el cambio de texto).
- **La herramienta sigue libre:** se puede editar, cargar otro archivo y lanzar más trabajos de la misma
  herramienta; se añaden a su carril (JOBS_SPEC §4). Las listas propias de cada herramienta (cola del Visualizer,
  de Upscale) siguen viéndose en su columna como vista de sus jobs, sin bloquear el resto de la herramienta.
- **Cambiar de herramienta o ir a Home** no afecta a nada; el punto viaja con la ventana.
- **Resultado:** "Open" en la píldora o en la bandeja abre el archivo con la app del sistema; "Send to…" y "Open in
  Library" lo reutilizan dentro de Halation sin salir de la herramienta actual hasta que el usuario lo elige.
- **Mientras la ventana no está a la vista:** notificación de Windows al terminar cada trabajo o lote (uno por
  grupo, no por imagen), y progreso total en el botón de la barra de tareas (hoy `S.progress`, ahora sumado de
  todos los jobs). Al volver, la píldora resume lo que terminó mientras tanto ("3 finished · Show").

---

## 3. Bandeja

```
┌────────────────────────────────────────────────┐
│ Processes        2 running · 3 queued   ⋯      │
├────────────────────────────────────────────────┤
│ RUNNING                                        │
│ ▣ cover.jpg            Image Upscale      ✕    │
│   4× · Upscaling ██████████░░░░░ 62 % · 0:38   │
│ ▣ Single June.mp4      Audio Visualizer   ✕    │
│   Encoding ████░░░░░░░░░░░░░░ 21 % · 3:10      │
│ QUEUED                                         │
│ ⋮⋮ ▣ clip.mov          AI Interpolate   ⏸ ✕   │
│      Waiting for GPU                           │
│ ⋮⋮ ▸ Upscale batch · 7 of 20     ⏸ ✕           │
│ FINISHED                               Clear   │
│ ✓ track.mp3            Downloader  Open ⋯      │
│ ✕ poster.png           Grade  Failed  Retry ⋯  │
├────────────────────────────────────────────────┤
│ Cancel all                Processing settings →│
└────────────────────────────────────────────────┘
```

- **Compacta por defecto:** Running y Queued desplegados; Finished plegado en una línea ("3 finished") que se
  despliega con un clic.
- **Forma:** popover desde el punto (`motion.js` → `openPopover`), 380 px de ancho, alto hasta el 60 % de la
  ventana con scroll interno; sale hacia arriba y a la derecha del punto, sin tapar el rail.
- **Cabecera:** "Processes", contadores, menú `⋯` (Cancel all queued, Clear finished).
- **Running:** miniatura, título, herramienta (icono y nombre), detalle, etapa, barra de progreso (`motion.js`
  `bar`; `.prog.indet` si no se conoce), porcentaje y tiempo restante, botón cancelar.
- **Queued:** en orden de ejecución. Asa para arrastrar y reordenar (dentro de su prioridad; `motion.js` `flip` /
  `list`), retener / soltar (⏸ / ▶), cancelar. El motivo de espera en una línea ("Waiting for GPU", "Waiting for
  memory", "Held").
- **Grupos:** un lote se ve como una fila plegable ("Upscale batch · 7 of 20") con su progreso total; desplegado,
  sus jobs. Cancelar el grupo cancela todos.
- **Finished:** los últimos 50 de la sesión, más nuevo arriba: hecho (Open, Show in folder, Send to…, Open in
  Library), fallado (Retry, "Show details" con el error y las últimas líneas del proceso), cancelado. "Clear" los
  quita de la lista.
- **Pie:** "Cancel all" (pide confirmación en la misma fila del botón: "Cancel 5 jobs?") y el enlace a Settings →
  Processing. La bandeja no tiene ajustes propios.
- **Clic en una fila:** abre su detalle en la misma fila (etapa, archivos, origen). Ir a la herramienta es un botón
  explícito (icono de la herramienta), nunca el clic en la fila.
- **Cancelar un job en marcha:** un clic si lleva menos de 10 s; si lleva más, el botón pasa a "Cancel?" durante 3 s
  y un segundo clic cancela.
- **Vacía:** "Nothing running" y, si hay terminados, la lista Finished.

---

## 4. Teclado y accesibilidad

- Ctrl+J abre y cierra la bandeja desde cualquier vista (incluida una herramienta con foco en su iframe:
  `globalKeys`). Esc la cierra y devuelve el foco a donde estaba.
- Dentro: flechas arriba / abajo entre filas, Supr cancela (con la misma confirmación), Alt+↑ / Alt+↓ mueven un job
  en cola, Espacio retiene / suelta, Intro abre el resultado de un terminado.
- El punto es un botón con `aria-label` "Processes: 2 running, 3 queued"; la píldora de evento usa
  `role="status"` (`aria-live="polite"`); la bandeja es un `dialog` no modal con su lista como `listbox`.

---

## 5. Movimiento

- Todo por `motion.js` y los tokens (`archive/tauri/motion.md`): el punto cambia de tamaño con `transform: scale` en el
  resorte; la píldora es un fondo que escala en X desde el punto y un texto que entra con opacidad (sin animar
  `width`); la bandeja con `openPopover` / `closePopover`; filas con `list` (entrar, salir en fantasma, reordenar
  con Flip); progreso con `bar`.
- El anillo del punto se actualiza con cada evento de progreso sin tween (es un dato, no una transición); el arco
  indeterminado gira con transform.
- Movimiento reducido: la píldora y la bandeja aparecen con un fundido corto; el arco no gira.

---

## 6. Modelo de datos

No guarda trabajos: los lee de `__hal.jobs` (`list()`, evento `jobs`). Estado propio en `app.json` → `ui.processes`:

```json
{ "ui": { "processes": { "open": false, "groupsOpen": ["upscale-batch-7"] } } }
```

- `open`: la bandeja se vuelve a abrir al arrancar solo si estaba abierta y hay trabajos.
- La píldora de evento se alimenta de las transiciones de estado de los jobs (`queued → running`, `running → done |
  failed`, `waiting` con `waitingFor` más de 3 s).
- Código: sección `processes` en `shell.js` (o un archivo `processes.js` si pasa de ~300 líneas), CSS en
  `shell.css`, textos `proc.*` en `en.json`.

---

## 7. Parámetros y valores por defecto

| Parámetro                                | Defecto                                     |
|------------------------------------------|---------------------------------------------|
| Tamaño del punto en reposo / actividad   | 6 px / 10 px                                |
| Distancia al borde inferior              | 16 px                                       |
| Duración de la píldora                   | 4 s (se mantiene con el ratón encima)       |
| Aviso de espera por recurso              | tras 3 s esperando                          |
| Ancho de la bandeja                      | 380 px                                      |
| Alto máximo                              | 60 % de la ventana                          |
| Finished guardados                       | 50 (en memoria, por sesión)                 |
| Confirmar cancelar                       | jobs en marcha con más de 10 s              |
| Atajo                                    | Ctrl+J                                      |

---

## 8. Criterios de aceptación

1. Sin trabajos, el punto mide 6 px, no brilla y no cambia nada de la vista.
2. Lanzar un export en el Visualizer e ir a Grade: el punto pasa a actividad con anillo; al terminar, la píldora
   "exported" aparece 4 s y su "Open" abre el archivo sin cambiar de herramienta.
3. Abrir la bandeja con Ctrl+J desde Grade, cancelar un job de Upscale y cerrar con Esc: Grade no pierde su estado
   ni su foco, y el proceso de upscayl-bin ya no existe (JOBS_SPEC §10.7).
4. Reordenar dos jobs en cola por arrastre o Alt+↑ cambia el orden en que arrancan.
5. Un job esperando la GPU muestra "Waiting for GPU" en su fila y en la píldora pasados 3 s.
6. Un lote de 20 imágenes es una sola fila con "n of 20" y su cancelación en grupo.
7. Un fallo deja el borde rojo en el punto hasta abrir la bandeja; "Show details" enseña el error.
8. La bandeja no tapa el rail y cabe en la ventana mínima de la app sin scroll horizontal.
9. Movimiento reducido: sin escalas ni giros, solo fundidos.
10. Textos nuevos solo en `en.json`; colores solo de `tokens.css`.
11. Lanzar un export devuelve el control en menos de 100 ms: justo después se puede mover un slider, cargar otro
    archivo y lanzar un segundo export en la misma herramienta.
12. Cambiar el proyecto después de lanzar no cambia el resultado del trabajo ya lanzado (comparado con un export sin
    cambios).
13. Con la ventana minimizada, un lote de 20 imágenes da una sola notificación al terminar y la barra de tareas
    muestra el progreso total; al volver, la píldora dice cuántos terminaron.
14. Tests: `tests/processes.js` (estados del punto, píldora, bandeja, teclado, reordenar, cancelar, grupos) con
    jobs simulados en `host.js`; `tests/motion.js` incluye abrir / cerrar la bandeja y la píldora (traza sin tareas
    de más de 50 ms); capturas del punto en cada estado y de la bandeja con trabajos para el OK visual de Java.

---

## 9. Fuera de alcance

- Historial de trabajos entre sesiones.
- Avisos que no son de trabajos (siguen siendo `toast`).
- Gráficas de uso de CPU / GPU / RAM en la bandeja.
- Mover el punto a otra esquina o esconderlo.
- Pausar un job en marcha (JOBS_SPEC §11).

## 10. Decisiones abiertas (valor por defecto elegido)

- Nombre en la interfaz: **Processes** (alternativas: "Jobs", "Activity").
- El punto en reposo visible y apagado (elegido) frente a oculto hasta el primer trabajo.
