# Task-oriented OmO sidebar (local presentation only)

User-requested override for OmO Slim 3.0.4. It replaces its role/model catalog with actual native child tasks, En curso / Terminados groups, state, session lifetime, short model names, clickable sessions and a return-to-coordinator link. Native Context and session title remain untouched.

The official server package and its dispatch, providers, fallback, workers and Git behavior are unchanged. The project registers the adjacent `plugin/` directory after the official package. Its server entry is deliberately empty: it only advertises the TUI export to OpenCode's plugin inventory. Its TUI loads the compiled presentation, which uses the stock TUI ID, replacing rather than duplicating the original sidebar. Native source watching hot-reloads that presentation without a service restart. No Drive code is used.

## Runtime contract

The compiled presentation is deliberately not vendored in this repository. `runtime-manifest.json` pins:

- the `oh-my-opencode-slim` package at version 3.0.4, upstream release commit `ea5859f`;
- the sha256 of the compiled `dist/tui2.js`;
- the required runtime layout: the package plus `solid-js`, `seroval`, `seroval-plugins` and `jsonc-parser`. `@opentui/core` and `@opentui/solid` are provided by the OpenCode host process, as they already are for the official plugin.

`plugin/runtime.js` resolves the runtime in this order:

1. `OMO_READABLE_SIDEBAR_RUNTIME`: absolute path to a runtime directory, for relocation or a personal install;
2. the shared user-level runtime `~/.local/share/omo-slim-readable-ui/3.0.4`;
3. `<checkout>/.tools/orchestrator-replacement/runtime`: legacy checkout-local build tree.

Every candidate must contain `node_modules/oh-my-opencode-slim` with the pinned version and a byte-identical `dist/tui2.js`. A candidate that fails any check is rejected with the reason. If no candidate is usable, the plugin throws a startup error that lists every checked path and points to this section; it never falls back to the stock sidebar silently.

## Build and recovery

The source is `tui.patch` against release commit `ea5859f`, plus `readable-sidebar.ts` and its projection tests. To rebuild the presentation:

1. check out the pinned upstream commit;
2. apply `tui.patch` and place `readable-sidebar.ts` next to `src/tui.ts`;
3. compile `src/v2/tui.ts` with the upstream `build:tui` flags;
4. copy only the output over the runtime's `node_modules/oh-my-opencode-slim/dist/tui2.js`;
5. update `runtime-manifest.json` if the presentation changes.

A dependency reinstall can overwrite the compiled presentation. Recovery: restore the pinned runtime from the private harness archive, or rebuild as above. Do not patch OpenCode's shared npm cache: other projects use it.

Rollback: remove the presentation plugin entry from the repository's `.opencode/opencode.json`; the official TUI remains. Do not restore Drive.

The custom view is enabled by the repository's `.opencode/readable-sidebar.json` marker.

## Validation

`readable-sidebar.test.ts` runs with the pinned bun (6 projection tests). The compiled module was verified to load from the runtime layout above when the host-provided `@opentui` modules are present; it has no other external dependency. The live mount receipt from the previous checkout is historical evidence of the UI path, not a visual approval. Visual acceptance remains manual.
