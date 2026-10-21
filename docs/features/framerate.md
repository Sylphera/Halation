# Frame Rate — Especificación v1

Status: Planned — not ported to the native app; implemented in the Tauri app on `main` (AI Interpolate).

Herramienta que multiplica los fotogramas por segundo de un vídeo con interpolación por IA. Idea de Java:
2026-09-27 ("un multiplicador de frame rate de los vídeos con algoritmo IA, así de fácil").

---

## 0. Principios

1. **Local.** Motor RIFE en binario ncnn-vulkan (`rife-ncnn-vulkan`, licencia MIT), descargable como componente
   igual que upscayl-bin: GPU por Vulkan, CPU si no hay GPU.
2. **El audio no se toca.** Se copia tal cual; la duración del vídeo no cambia.
3. **Simple.** Un vídeo, un factor, un botón. La calidad avanzada va en un desplegable.

---

## 1. Distribución de la pestaña

```
┌──────────────────────────────────────────────────┬──────────────────────┐
│                                                  │ SOURCE               │
│        VISTA PREVIA  antes │ después             │ clip.mp4 · 1080p     │
│        (comparador, cámara lenta ×0.25 opcional) │ 24 fps · 00:42       │
│                                                  │                      │
│                                                  │ TARGET               │
│ ▶ ⟲  00:03.10 / 00:42   ─────●───────────        │ [×2] [×4] [60 fps]   │
│                                                  │ → 48 fps · 2 016 fr. │
│                                                  │ ▸ Advanced           │
│                                                  │                      │
│                                                  │ [ Convert ]  Send to…│
│                                                  │ ████████░░ 71 % 2:10 │
└──────────────────────────────────────────────────┴──────────────────────┘
```

- Sin vídeo: zona de soltar (archivo, Library, Downloader, Send to…).
- Vista previa: los 2 s alrededor del cursor se interpolan al pulsar "Preview" y se muestran lado a lado con el
  original a velocidad normal o ×0.25.

---

## 2. Parámetros

| Parámetro | Valores | Por defecto |
|---|---|---|
| Target | ×2, ×4, o fps objetivo (30, 50, 60, 120) | ×2 |
| Model (Advanced) | RIFE v4.6 (rápido), RIFE v4.22 (calidad) | v4.6 |
| Scene detection (Advanced) | on / off: en un corte de escena se duplica el frame en vez de interpolar | on |
| Output codec | el de Settings (H.264 / HEVC / VP9), calidad de Settings | Settings |

- fps objetivo que no es múltiplo: RIFE v4 interpola en tiempos arbitrarios (`-n` fotogramas totales).

---

## 3. Proceso

1. FFmpeg extrae los frames a PNG en `Tools\temp\framerate\<id>\in` (o por tramos de 30 s en vídeos largos, para no
   llenar el disco; espacio estimado mostrado antes de empezar, aviso si falta).
2. `rife-ncnn-vulkan -i in -o out -n <total> -m <modelo> [-u]` con prioridad baja (`procs.rs` `low`).
3. FFmpeg codifica `out` al fps nuevo con el audio original copiado (`-c:a copy`) y los metadatos del original.
4. Resultado en `Exports\Videos\{nombre} ({fps} fps).mp4`; los temporales se borran al terminar o cancelar.

- Progreso por frames escritos; cancelar mata los procesos y limpia.
- Componente `rife` en `COMPONENTS` (~60 MB con los dos modelos), instalado desde Settings → Modules o al abrir la
  herramienta; `tools.rs` lo busca e instala como upscayl-bin.

---

## 4. Integración

- `modules.js`: `framerate`, icono `gauge`, grupo 1, `deps: [{ id: "ffmpeg" }, { id: "rife" }]`, `accepts: { video:
  "takeVideo" }`, `gives: ["video"]`, `stage: "beta"`, tarjeta en Home y en el buscador.
- Send to… desde la Library, el Downloader, el Visualizer (su vídeo exportado) y la Intro; envía a Frame Grab,
  Intro.

---

## 5. Criterios de aceptación

1. Vídeo de 24 fps ×2 → 48 fps, el doble de frames exacto, misma duración (±1 frame), audio idéntico bit a bit.
2. ×4 y 60 fps objetivo dan el número de frames esperado.
3. Los frames originales siguen presentes en sus posiciones (diferencia 0 en los pares con ×2).
4. Corte de escena con detección activada: sin frame mezclado entre las dos escenas.
5. Cancelar deja el disco como estaba.
6. Test de usuario: cargar, cargar un segundo vídeo, cambiar de herramienta y volver, preview, convertir, Send to
   Frame Grab; regresión de Frame Grab, Downloader y el export del Visualizer. Binario falso en `tests/` como
   `fake-upscayl.js`; un test contra el binario real con `npm run test:real`.

---

## 6. Fuera de alcance en la v1

- Cámara lenta (cambiar la duración).
- Cola de varios vídeos.
- Otros motores (DAIN, FILM).
