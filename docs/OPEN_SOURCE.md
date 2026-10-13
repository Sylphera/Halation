# Apertura del código (open source)

Halation pasa de freeware cerrado a software libre antes de la migración a Qt Quick. Este documento fija el plan, lo
que ya está preparado y los pasos que no se pueden deshacer.

## Decisiones

- Licencia: **GPL-3.0-or-later** (`LICENSE` literal de la FSF, `NOTICE.md` con el aviso). Permiso adicional de la
  sección 7 para combinar con GSAP (licencia propia de GreenSock, no compatible con la GPL sin él).
- Marca: el nombre "Halation", el logo, el icono y el wordmark quedan fuera de la GPL (`TRADEMARKS.md`). Un fork
  necesita otro nombre e icono.
- Un solo repositorio: **Sylphera/Halation**. Conserva estrellas, releases (v1.1.0, cutout-sam21-v1, stems-v1,
  stems-v4) y la URL del actualizador (`releases/latest/download/latest.json`), así que las copias instaladas siguen
  actualizándose sin cambios.
- Historial nuevo: el `main` público empieza en un único commit con el árbol de esta rama. El historial privado
  (175 commits, ~1 GB de `.git`, rutas personales, autores de agentes) no se publica.
- Halation-source se archiva como privado; no se borra (guarda el historial y, hasta el cambio, el secreto de firma).

## Qué sale del árbol público

| Fuera | Motivo |
|---|---|
| `docs/migration-2026-10-02/`, `CLAUDE_HANDOFF.md`, `review/`, `docs/readme-backups/` | Notas internas de worktrees y rutas del PC |
| Trazas en bruto de `docs/performance*/` (`.json`, `.jsonl`, `.log`, ~250 MB) | Peso y rutas personales; los `.md` con las conclusiones se quedan |

Además: rutas `C:/Users/…` sustituidas por variables de entorno en `app/scripts` y `app/tests/auralis.js`; nombres
de los PCs fuera de `docs/PREVIEW.md`; el ID real de Spotify de los tests (una canción con derechos, el mismo patrón
que llevó a la retirada de youtube-dl en 2020) cambiado por uno inventado. `.gitignore` evita que vuelvan las trazas.

## Qué cambia en la app

- Ajustes → Acerca de: "Free software (GPL-3.0)" (en.json; en es.json solo esa clave, porque el texto anterior,
  "Software propietario", pasaría a ser falso).
- Ajustes → Licencia muestra `NOTICE.md` + la GPL (`system.rs::legal_text`), y el instalador copia `NOTICE.md`.
- Metadatos: `Cargo.toml` (`license = "GPL-3.0-or-later"`), `package.json`, copyright y publisher de
  `tauri.conf.json`.
- Llega a los usuarios con la siguiente release; esta tarea no publica build.

## Pendiente de Java antes de publicar

1. **Fondos de 21st.dev** (decisión de Java, 13-10-2026): Auralis (Aman Shakya) y Aurora Veil (Isaiah Bjork) vienen de
   componentes de 21st.dev sin licencia y no están en el repo público. Aquí van la reescritura propia (Auralis v2 en sala
   limpia y Welcome Cáusticas, `docs/BACKGROUNDS_SPEC.md`), pendiente de que Auralis quede idéntico al actual en un
   thread aparte. Hasta entonces las builds y releases salen de Halation-source (privado, con los fondos anteriores) y
   este repo no publica builds ni releases.
2. **Regla de autoría**: autorizada por Java el 13-10-2026; está en `CLAUDE.md` y `AGENTS.md` y cubre a cualquier agente
   (Claude Code, Codex u otro).
3. **`docs/examples/grade.jpg`** (foto de The Weeknd, autor y licencia desconocidos): ya está en las capturas
   públicas; en un repo libre conviene sustituirla por una foto con licencia clara.
4. Riesgo conocido, no bloqueante: `spotify-metrics.js` y `profile.js` leen APIs internas de Spotify (pathfinder) y
   SoundCloud (`client_id` de su web). Con el código público se ve más fácilmente; el riesgo es de ToS (bloqueo o
   carta), no de licencia.

## Pasos de publicación (irreversibles, con confirmación de Java)

1. Fusionar esta rama en `main` de Halation-source (PR que abre y fusiona Java).
2. Crear el commit único:
   `git checkout --orphan open-source main && git commit -m "Halation 1.1.1, open source"` con autor
   `Sylphera <233718609+Sylphera@users.noreply.github.com>`.
3. En Sylphera/Halation: guardar el `main` actual como rama `legacy-site` y añadir los secretos
   `TAURI_SIGNING_PRIVATE_KEY` (y la contraseña vacía si se usa).
4. `git push --force origin open-source:main` en Sylphera/Halation. Los tags y releases existentes no cambian.
5. Ajustes del repo: descripción, topics, Issues, "Private vulnerability reporting", squash merge por defecto.
6. Archivar Halation-source. Las ramas sin fusionar (Grade: `claude/grade-looks-spec-6vejsj`) se llevan al repo
   público como parche sobre el nuevo `main`.
7. La siguiente versión sale de Sylphera/Halation con un commit `[build]` (el workflow ya publica en el mismo repo y
   `latest.json` ya apunta ahí). La pre-release 1.2.0-beta.1 no se toca.
8. Promoción (borradores en la carpeta del proyecto `open-source/`), solo cuando el repo esté publicado.
