// Task-oriented OmO Slim sidebar.
//
// Re-exports the pinned presentation built from tui.patch against OmO Slim
// 3.0.4. Resolution order and recovery are documented in ../README.md and
// ../runtime-manifest.json; a missing or stale build fails loudly.
import { pathToFileURL } from 'node:url';
import { resolveRuntime } from './runtime.js';

const presentation = resolveRuntime();
const loaded = await import(pathToFileURL(presentation).href);

export default loaded.default;
