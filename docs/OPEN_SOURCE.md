# Apertura del código (open source)

Halation pasó de freeware cerrado a software libre el 13-10-2026, antes de la migración a Qt Quick. Este documento
recoge las decisiones, lo que se hizo y lo que queda.

## Decisiones

- Licencia: **GPL-3.0-or-later** (`LICENSE` literal de la FSF, `NOTICE.md` con el aviso). Permiso adicional de la
  sección 7 para combinar con GSAP (licencia propia de GreenSock, no compatible con la GPL sin él).
- Marca: el nombre "Halation", el logo, el icono y el wordmark quedan fuera de la GPL (`TRADEMARKS.md`). Un fork
  necesita otro nombre e icono.
- Un solo repositorio: **Sylphera/Halation**, con el código, los issues y las releases. Conserva las releases de modelos
  (cutout-sam21-v1, stems-v1, stems-v4), que la app descarga, y la URL del actualizador
  (`releases/latest/download/latest.json`).
- Historial nuevo: el `main` público empezó en un único commit ("Halation 1.1.1, open source"). El historial privado
  (175 commits, ~1 GB de `.git`, rutas personales, autores de agentes) no se publica.
- Halation-source (privado) queda sin uso y lo elimina Java.

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
- Llegó a los usuarios con la release 1.1.1, la primera del repo público (solo setup, sin portable; clave del updater
  nueva, `docs/UPDATES.md`).

## Fondos de 21st.dev

Auralis (Aman Shakya) y Aurora Veil (Isaiah Bjork) venían de componentes de 21st.dev sin licencia y no están en el repo
público. En su lugar van la reescritura propia en sala limpia: Auralis v3, aprobado por Java el 13-10-2026, y el fondo
de Welcome Cáusticas (`docs/BACKGROUNDS_SPEC.md`).

## Pendiente

1. **`docs/examples/grade.jpg`** (foto de The Weeknd, autor y licencia desconocidos): ya está en las capturas
   públicas; en un repo libre conviene sustituirla por una foto con licencia clara.
2. Riesgo conocido, no bloqueante: `spotify-metrics.js` y `profile.js` leen APIs internas de Spotify (pathfinder) y
   SoundCloud (`client_id` de su web). Con el código público se ve más fácilmente; el riesgo es de ToS (bloqueo o
   carta), no de licencia.
3. Promoción (borradores en la carpeta del proyecto `open-source/`).
