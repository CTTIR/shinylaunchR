# Dependency advisories & supply-chain notes

_Last reviewed: 2026-06-16 (Audit 5)._

## Runtime dependencies

`npm audit --omit=dev` reports **0 vulnerabilities**. The only runtime
dependency is `keytar` (MIT) and its `prebuild-install` transitive tree
(MIT/ISC/BSD). There are **no copyleft (GPL/AGPL) runtime dependencies**, so the
app's MIT license is unaffected. `react`/`react-dom` are dev-only: they are
bundled into the renderer by Vite, so they are not shipped as `node_modules`.

## Resolved this audit

- **electron** `^33 → ^42` — clears 18 Electron advisories (ASAR integrity
  bypass, several use-after-frees, IPC spoofing, origin/permission issues, etc.).
  This is the security-maintained current major. The app uses only stable APIs
  (`BrowserWindow`, `ipcMain`, `contextBridge`, `nativeTheme`, `shell`, `dialog`,
  `Menu`); typecheck/lint/test/build all pass on 42.
- **electron-builder** `^25 → ^26` — clears the `tar` / `cacache` /
  `make-fetch-happen` / `node-gyp` / `dmg-builder` / `app-builder-lib` chain.

## Deferred dev-only advisories (documented, justified)

The following remain in `npm audit` (full, dev-inclusive). All are **build/test
tooling only**, not shipped in any installer, and not reachable in how we use
the tools:

| Advisory | Package | Why deferred |
|----------|---------|--------------|
| GHSA-5xrq-8626-4rwp (critical) | `vitest` | Arbitrary file read/exec **only when the Vitest UI server is listening**. Our `test` script is `vitest run` — the UI server is never started. Fix requires `vitest@4`, which needs `vite@6+`. |
| GHSA-67mh-4wv8-2f99 (high) | `esbuild` | Dev-server SSRF affecting `vite dev` only. No impact on built app or CI. The fix is in `vite@8`, but `electron-vite` (our bundler) peer-caps Vite at `^7`, so it **cannot** be cleared without dropping electron-vite. |
| moderate | `vite` / `vite-node` / `@vitest/mocker` / `electron-vite` | Same Vite/Vitest chain; dev tooling only. |

**Why not bump the whole bundler chain:** clearing the Vitest/Vite advisories
would require migrating `electron-vite` `2 → 5`, `vite` `5 → 7`, and
`vitest` `2 → 4` together — a multi-major bundler migration whose dev-server and
packaging behaviour cannot be fully validated in CI here — while the headline
`esbuild` advisory would **still** remain (it needs Vite 8, above
electron-vite's `^7` cap). Since none of these are exploitable in our usage
(no `vitest --ui`, no exposed dev server in CI, nothing shipped), we defer the
migration rather than risk the toolchain.

**Planned follow-up:** revisit when `electron-vite` supports Vite 8 (which
carries the patched esbuild), then bump the Vite/Vitest/electron-vite trio in one
deliberate, re-tested step.

## Hygiene

- Lockfile (`package-lock.json`) committed and in sync (`npm ci` succeeds).
- No unused or phantom dependencies; no wildcard version ranges.
- No `postinstall`/lifecycle scripts in this repo's `package.json`.
- `.gitignore` excludes `node_modules/`, `out/`, `dist/`, `release/`, and env files.
