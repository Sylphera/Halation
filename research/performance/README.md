# Performance research

Measurements and experiments, kept for their method and numbers. None of them is a description of the current app:
check the context of each before reusing a figure. The native app's own measured costs are in
[docs/SLINT_VISUAL_SYSTEM.md](../../docs/SLINT_VISUAL_SYSTEM.md) and
[planning/decisions.md](../../planning/decisions.md).

| Report | Context | Applies to the native app? |
| --- | --- | --- |
| [2026-10-22-converter-native.md](2026-10-22-converter-native.md) | Native Converter: copy vs re-encode, audio/image timings, audio preview, UI thread during batches | Yes (container figures; Windows pending) |
| [2026-10-04-report.md](2026-10-04-report.md) | Tauri 1.0.1 portable, WebView2: UI pass (IPC, layout, canvas, heap) | Method only |
| [tool-transitions/](tool-transitions/README.md) | Tauri, WebView2: tool transitions, springs and shadows | No (web animation) |
| [frame-budget-111/](frame-budget-111/README.md) | Tauri 1.1.1, WebView2: frame budget of the Home background and tools; the closure is in [FINAL.md](frame-budget-111/FINAL.md) | The background decisions (320 px field, 15 Hz, stationary grain) carried over to the native Drape loop |
| [auralis-2/](auralis-2/README.md) | Tauri: cached and animated variants of the Home background. "Auralis" is the old name of the Drape | Background design history; the native app plays a recording instead |
