// Resolves the pinned OmO Slim 3.0.4 TUI build used by the task-oriented sidebar.
//
// The build is deliberately not vendored in this repository. It lives in a
// neutral, user-level runtime shared by every checkout, and can be relocated
// with OMO_READABLE_SIDEBAR_RUNTIME. Resolution is strict: the package version
// and the sha256 of the compiled presentation must match runtime-manifest.json.
// A missing or stale runtime is an explicit error, never a silent fallback to
// the stock sidebar.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checkoutRoot = resolve(here, '..', '..', '..', '..');
const manifestPath = resolve(here, '..', 'runtime-manifest.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

export const RUNTIME_PIN = manifest.version;
export const PRESENTATION_SHA256 = manifest.presentation.sha256.toLowerCase();

export function runtimeCandidates({ env = process.env, home = homedir(), checkout = checkoutRoot } = {}) {
  const candidates = [];
  if (env.OMO_READABLE_SIDEBAR_RUNTIME) {
    candidates.push({ kind: 'OMO_READABLE_SIDEBAR_RUNTIME', dir: resolve(env.OMO_READABLE_SIDEBAR_RUNTIME) });
  }
  candidates.push({
    kind: 'shared runtime',
    dir: join(home, '.local', 'share', 'omo-slim-readable-ui', RUNTIME_PIN),
  });
  candidates.push({
    kind: 'checkout-native runtime',
    dir: join(checkout, '.tools', 'orchestrator-replacement', 'runtime'),
  });
  return candidates;
}

export function resolveRuntime(options = {}) {
  const problems = [];

  for (const candidate of runtimeCandidates(options)) {
    const packageDir = join(candidate.dir, 'node_modules', 'oh-my-opencode-slim');
    const packageJson = join(packageDir, 'package.json');
    const presentation = join(packageDir, 'dist', 'tui2.js');

    if (!existsSync(packageJson) || !existsSync(presentation)) {
      problems.push(`${candidate.kind} (${candidate.dir}): node_modules/oh-my-opencode-slim/dist/tui2.js not found`);
      continue;
    }

    let version;
    try {
      version = JSON.parse(readFileSync(packageJson, 'utf8')).version;
    } catch (error) {
      problems.push(`${candidate.kind} (${candidate.dir}): unreadable package.json (${error.message})`);
      continue;
    }
    if (version !== RUNTIME_PIN) {
      problems.push(`${candidate.kind} (${candidate.dir}): oh-my-opencode-slim ${version} != pinned ${RUNTIME_PIN}`);
      continue;
    }

    let digest;
    try {
      digest = createHash('sha256').update(readFileSync(presentation)).digest('hex');
    } catch (error) {
      problems.push(`${candidate.kind} (${candidate.dir}): unreadable presentation (${error.message})`);
      continue;
    }
    if (digest !== PRESENTATION_SHA256) {
      problems.push(
        `${candidate.kind} (${candidate.dir}): dist/tui2.js sha256 ${digest} does not match the pinned build ${PRESENTATION_SHA256}`,
      );
      continue;
    }

    return presentation;
  }

  throw new Error(
    '[omo-readable-sidebar] No usable pinned OmO Slim TUI build was found; ' +
      'the task-oriented sidebar is not silently replaced by the stock one.\n' +
      'Checked:\n' +
      (problems.length ? problems.map((problem) => `  - ${problem}`).join('\n') : '  - (no candidates)') +
      '\nRecovery: restore the pinned 3.0.4 runtime described in ' +
      '.opencode/ui-patches/omo-slim-3.0.4/README.md, or point ' +
      'OMO_READABLE_SIDEBAR_RUNTIME at a runtime directory whose ' +
      'node_modules/oh-my-opencode-slim matches runtime-manifest.json.',
  );
}
