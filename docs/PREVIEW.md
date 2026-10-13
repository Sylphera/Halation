# Halation Preview

Loop de revisión visual: **push o edición en `app/dist` → la ventana Preview recarga sola en segundos**. No se recompila nada y no interviene Claude. Es la misma Halation con la feature de Cargo `preview`; no es una segunda codebase.

## Modos de trabajo

Cada hilo es Cloud o Local, nunca los dos. El flujo puede combinar dos hilos. Que una tarea necesite Preview no obliga a implementarla en Local: Cloud + Preview local es la opción normal cuando se quiere poder trabajar desde cualquier sitio.

1. **Local**: un hilo en el PC implementa y lleva Halation Preview a la vez, apuntando a su worktree (`halation-preview.cjs .`). Para mucha iteración visual delante del PC: UI nueva, responsive, animaciones, ajuste fino.
2. **Cloud + Preview local**:
   - El hilo Cloud implementa (`editar → commit → push`) siempre sobre la misma rama durante la iteración.
   - Un hilo Local permanente en el PC solo hace de operador: localiza el clone, sigue esa rama (`halation-preview.cjs <rama>`), arranca o reinicia Preview, hace `--build` solo cuando cambia Rust y deja el watcher funcionando.
   - Después, `push → ls-remote → fetch → checkout del worktree de preview → reload` sin turnos de Claude.

Responsabilidades:

- **Hilo Cloud**:
  - dice claramente qué rama usa;
  - sigue empujando a esa rama;
  - avisa cuando cambia `app/src-tauri` y hay que reconstruir Preview (la marca también lo indica).
- **Hilo Local**:
  - lleva toda la infraestructura local;
  - no hace capturas ni revisión visual automática;
  - no interviene en cada refresh;
  - reconstruye solo cuando hace falta.
- **Java**: indica el PC y revisa la ventana.

## Comandos

Todos se ejecutan desde cualquier carpeta. El repo es el del script, nunca el directorio actual.

```
node app/scripts/halation-preview.cjs --build <rama|ruta>        # compila el exe Preview (una vez, y en cada cambio de Rust)
node app/scripts/halation-preview.cjs <rama|ruta>                # ventana nativa, recarga automática
node app/scripts/halation-preview.cjs <rama|ruta> --chromium     # Edge/Chromium con el backend simulado (app/tests/host.js)
```

- **Ruta** (una carpeta que existe, o algo que solo puede ser ruta: empieza por `.` o `~`, es absoluta o lleva `\`): un worktree local usado tal cual. Un nombre con `/` que no es una carpeta existente es una rama (`claude/…`). Vigila `app/dist` y recarga en cada cambio.
- **Rama**: `origin/<rama>` en un worktree propio, `.tools/preview/<perfil>/worktree` (detached).
  - Cada `--interval` segundos (3 por defecto) hace `git ls-remote`. Si la rama avanza: `fetch`, checkout del commit nuevo y recarga.
  - Si ese worktree tiene cambios, no se toca: la marca y la consola lo dicen.
  - Nunca se escribe en `main`, en la rama local ni en otro worktree.
- `--path <dir>` y `--branch <nombre>` fuerzan cómo se interpreta el objetivo.
- Opciones: `--profile <nombre>`, `--port <n>` (CDP, 9237 por defecto), `--exe <ruta>`.

## Requisitos (una vez por PC)

- Git, Node y `npm install` en `app/`, que trae `@tauri-apps/cli` para `--build`.
- Playwright: `npm i --prefix .tools playwright`. Con `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` basta para la ventana nativa.
  - `--chromium` usa Edge en Windows, o `CHROME=<ruta>`.
- Para `--build`: Rust y MSVC, como para `npm run tauri build`, y el Windows SDK (`build.rs` usa `makeappx`).
  - Resultado: `.tools/preview/bin/halation-preview.exe` y su sidecar `halation-preview.build.json`.
  - La compilación usa `.tools/preview/target`; no toca `src-tauri/target` ni el instalador.

## Qué es el exe Preview

`tauri build --no-bundle --features preview --config src-tauri/tauri.preview.conf.json`:

- Identifier `com.halation.preview`, ventana "Halation Preview", binario `halation-preview.exe`, sin instalador. Nunca entra en una release (`build.yml` no usa la feature).
- **Datos aislados** en `%LOCALAPPDATA%\com.halation.preview`:
  - `profiles\<perfil>\Documents\Halation`: Sessions, Library, Settings, Presets, Exports…
  - `profiles\<perfil>\Local\Halation\workspace`.
  - `profiles\<perfil>\WebView2`.
  - `Tools`: FFmpeg, yt-dlp, modelos. Se comparte entre perfiles y está separada de `Documents\Halation\Tools`.
  - No lee ni escribe `Documents\Halation`, `%LOCALAPPDATA%\Halation` ni `com.halation.app`. Su AppUserModelId es `com.halation.preview`.
- **Sin single-instance**: convive con Halation estable.
- El perfil lo fija `HALATION_PREVIEW_PROFILE`, que pone el lanzador.

El lanzador solo actúa sobre una ventana cuyo comando `paths` devuelva carpetas de `com.halation.preview`. Si en el puerto CDP hay otra cosa, se niega.

## Cómo funciona

Es la técnica de los benchmarks (`ui-benchmark.cjs`), ampliada:

1. Arranca el exe con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<puerto>`, o reutiliza la ventana si el puerto ya responde.
2. Playwright se conecta por CDP e intercepta **todo** `http://tauri.localhost/**` (todas las ventanas y frames) con los archivos de `app/dist` del objetivo:
   - Content-type por extensión.
   - 403 fuera de `app/dist`, también con symlinks o `%2e%2e`.
   - **404 si falta un archivo**. Nunca se recurre al frontend embebido.
3. Un init script añade la marca, abajo a la izquierda: `PREVIEW · rama/worktree · commit` (`+changes` si `app/dist` tiene cambios sin commit). Debajo, en rojo, los avisos:
   - Rust distinto del exe.
   - 404.
   - Comandos IPC que el exe no tiene.
   - "launcher stopped" si el lanzador se cierra (desde ese momento la ventana ya no está viva; al recargar vuelve el frontend embebido, sin marca).
4. Al cambiar el frontend, recarga todas las páginas `tauri.localhost`.

## Regla Rust / frontend

- **Solo HTML/CSS/JS** (`app/dist`): recarga, sin build.
- **Rust, Tauri o comandos IPC nuevos** (`app/src-tauri`): `--build` una vez y después se vuelve al loop rápido.
  - `--build` guarda en el sidecar el tree git de `app/src-tauri` con el que se compiló.
  - La marca compara ese dato con el `app/src-tauri` del objetivo y avisa "Rust changed since the exe: rebuild Preview", o "uncommitted changes" si hay Rust sin commit.
- Un comando que el exe no tiene **falla igual que fallaría** (`Command x not found`). Además se registra en consola y en la marca. No se simula.
- No hay hot reload de Rust.

## Limitaciones de la primera versión

- Probado para **una preview por PC**. Los perfiles y puertos (`--profile`, `--port`) dejan preparadas varias a la vez, pero no se han validado.
  - `Tools` se comparte: dos previews instalando el mismo componente a la vez pueden pisarse.
- Recargar reinicia el estado de la interfaz (herramienta abierta, etc.), igual que F5.
- Los diálogos modales (capa superior) pueden tapar la marca mientras están abiertos.
- Los cambios que solo tocan `app/src-tauri` no recargan; solo actualizan la marca.
- Actualizador: la Preview nunca busca versiones; `dev/updates-fixture.js` simula una 1.2.0 con botones en Settings → About → Updates (docs/UPDATES.md).

## Verificación

`node app/tests/preview.js`: Chromium en el papel de la ventana WebView2, sobre repos git desechables. Cubre:

- routing, MIME, 404 y bloqueo fuera de `app/dist`;
- marca, recarga por edición local y por push;
- worktree con cambios intacto, `main` intacto;
- fingerprint Rust, comando IPC inexistente;
- rechazo de una ventana que no es Preview;
- `--chromium`.

No cubre el exe, WebView2 ni el aislamiento real en disco: eso se comprueba en Windows.
