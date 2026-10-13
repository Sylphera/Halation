# Remove Background — Especificación v2 (SAM 2.1)

Herramienta completa para quitar el fondo de una imagen. v1 (2026-09-27): automático + varita + pincel, atrás /
adelante, "Aplicar". v2 (Java, 2026-10-06): la misma interfaz sobre un único sistema de segmentación promptable,
SAM 2.1 Base+ (componente Cutout, `cutout-worker.js`). Automatic propone, la varita corrige con puntos y el pincel con
trazos; las tres herramientas alimentan la misma máscara. Remove hace el pase final de calidad.

---

## 0. Principios

1. **Nada se borra hasta Remove.** Las herramientas solo marcan (azul semitransparente); el borrado ocurre al pulsar
   Remove y queda como un paso del historial.
2. **Una sola máscara.** La imagen se codifica una vez (encoder, 1024 px); cada clic o trazo es una indicación más
   (punto de sujeto o de fondo) que el decoder resuelve junto con la respuesta anterior, en milisegundos en GPU.
3. **No destructivo.** El resultado es la imagen original más una máscara alfa editable; exportar compone las dos.
4. **Local.** Todo corre en el PC: el modelo del componente Cutout en ONNX Runtime Web.
5. **Mismos controles en los tres modos.**

---

## 1. Distribución de la pestaña

```
┌───────────────┬─────────────────────────────────────┬────────────────────┐
│ MODO          │                                     │ AJUSTES            │
│ (•) Auto      │           LIENZO                    │ Intensity   ──●──  │
│ ( ) Wand      │  imagen + selección azul            │ Tolerance   ──●──  │
│ ( ) Brush     │  (ajedrez donde ya no hay fondo)    │ Edge shift  ──●──  │
│               │                                     │ Feather     ──●──  │
│ Brush size ●  │                                     │ Backdrop [▦ ■ □ ●] │
│ [Brush][Erase]│                                     │                    │
│               ├─────────────────────────────────────┤ [ Remove ]         │
│ ⟲ ⟳  Reset    │ Before / After (comparador)  zoom   │ [ Export ▾ ] Send… │
└───────────────┴─────────────────────────────────────┴────────────────────┘
```

- Sin imagen: zona de soltar (archivo, Library, Send to…, "Back to").
- Rueda: zoom al cursor; espacio + arrastrar: mover. Comparador antes / después como el de Upscale.

---

## 2. Modos

### 2.1 Auto
- Al cargar la imagen el modelo la codifica (se reutiliza para todo lo demás) y Automatic propone el sujeto: una
  rejilla de clics sueltos (8 × 8 en GPU, 4 × 4 en CPU), cada uno con sus tres máscaras (parte, objeto, todo); las que
  recorren el borde superior, la parte alta de un lateral o todo el borde inferior (o casi toda la imagen) son fondo.
  El resto se agrupa (clics que encontraron lo mismo) y se ordena: confianza, tamaño, cercanía al centro y número de
  clics. Solo se proponen los puntos del mejor grupo, con su máscara como entrada; otro grupo se une solo si el modelo,
  preguntado por los dos, responde con su unión como una sola cosa segura (cabeza y cuerpo). Puntos sobre cosas
  distintas hacen que el modelo no responda por ninguna (1.1.0 marcaba trozos del fondo; Java, 2026-10-07).
- La misma imagen propone lo mismo: la propuesta se guarda con la imagen codificada, y sus rasgos también, así que el
  motor que se apaga tras 2 min sin uso los adopta al volver sin codificar otra vez. Abrir otra vez la imagen que ya
  está abierta (desde otra herramienta, Home o la Library) conserva el trabajo.
- "Detect subject" la repite; los puntos propios del usuario se conservan.

### 2.2 Wand (varita)
- Clic izquierdo: punto de sujeto (lo que se queda). Clic derecho o Alt + clic: punto de fondo, solo para afinar; sin
  sujeto no añade nada y pide marcarlo antes. Cada clic refina la misma selección (con la respuesta anterior como
  entrada). Los clics se ven como puntos (verde sujeto, azul fondo); el panel lo explica con los mismos colores.

### 2.3 Brush (pincel)
- Dos modos: Subject (por defecto, siempre al abrir) y Background (afinador; sin sujeto solo marca lo que pinta) (E
  alterna), tamaño ajustable (slider y `[` / `]`), círculo de previsualización.
- Al soltar, el trazo se convierte en hasta 6 puntos a lo largo del recorrido y se pinta en la respuesta anterior
  (fondo seguro / sujeto seguro) como entrada del modelo; el modelo extiende el trazo a la parte a la que pertenece.
  Lo pintado siempre cuenta como lo que dice.

### 2.4 Remove (pase final)
- Si el sujeto ocupa una parte pequeña de la imagen, el recorte que lo rodea (+12 %) se codifica aparte a 1024 px y se
  resuelve con los mismos puntos: más resolución del modelo en el borde.
- Refinado del borde sin segundo modelo: filtro guiado en color sobre la imagen, con la guía suavizada y un eps por
  encima de la varianza del grano, para que el grano y los filtros no se peguen al contorno.
- Luego los ajustes comunes y el borrado.

---

## 3. Controles comunes (los tres modos)

| Control | Rango | Por defecto | Efecto |
|---|---|---|---|
| Intensity | 0–100 % | 50 % | Dónde corta la máscara del modelo (±6 en logits): más, más fondo |
| Threshold | 0–100 % | 50 % | Dureza del borde (temperatura de la sigmoide) |
| Soft edge | 0–20 px | 1 | Suavizado del borde |
| Contract / expand | −20…+20 px | 0 | Crece o encoge el sujeto (`refineMask`) |
| Edge colour cleanup | 0–100 % | 50 % | Quita el tinte del fondo antiguo en el borde |
| Small islands | 0–2 % | 0,2 % | Trozos sueltos en el fondo más pequeños que esto se van con él |
| Backdrop | ajedrez, negro, blanco, color | ajedrez | Solo para ver; no forma parte del resultado |

---

## 4. Modelo de datos

```
R = {
  src: { blob, name, path?, iw, ih },
  alpha: Uint8 (W×H)        // máscara aplicada: 255 = se ve (trabajo a ≤1600 px)
  sam: handle               // la imagen codificada (HAL.samEmbed)
  points: [{ x, y, label, auto?, stroke? }]   // fracciones; label 1 sujeto, 0 fondo
  logits: Float32 (256×256) // la última respuesta del modelo
  paint, keep: canvas       // trazos de fondo y de sujeto
  sel: Uint8 (W×H)          // selección pendiente (azul)
  history: [...]            // un paso por indicación, Remove o Clear; máx. 30
}
```

---

## 5. Exportación e integración

- Export: PNG con transparencia (por defecto), WebP con transparencia, o JPG sobre el color de Backdrop.
  Carpeta `Exports\Cutouts`, nombre `{nombre} (no background).png`.
- Send to… (acepta y da `image`): recibe de cualquier herramienta, envía a Grade, Upscale, Intro, Visualizer.
  "Back to <origen>" devuelve el resultado.
- Registro en `modules.js`: `removebg`, icono `eraser`, grupo 1, `deps: [{ id: "cutout", optional: true }]`
  (las tres herramientas lo necesitan), `stage: "beta"`, tarjeta en Home y en el buscador.
- La Library ("Add cutout version") y el diálogo de Cutout siguen igual.

---

## 6. Criterios de aceptación

1. Automatic, Wand y Brush marcan en azul la misma selección y no borran nada hasta Remove.
2. Remove → los píxeles seleccionados quedan transparentes; exportar da exactamente esa máscara.
3. Atrás / adelante recorren cada indicación, Remove y Clear; cambiar de modo no pierde la selección ni el historial.
4. Sin el componente Cutout: las herramientas ofrecen la descarga.
5. Tiempos (GPU): cargar 1–3 s, cada clic o trazo inmediato, Remove 1–30 s.
6. Flujo de usuario en test: cargar, cargar una segunda, cambiar de herramienta y volver, deshacer, exportar,
   Send to Upscale; regresión de Cutout, Crop y Upscale.

---

## 7. Fuera de alcance en la v1

- Relleno inteligente del hueco (inpainting) o sustitución del fondo por otra imagen.
- Vídeo.
- Selección por bordes (lazo magnético).
