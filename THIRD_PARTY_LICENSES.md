# Third-Party Licenses

shinylaunchR is MIT-licensed (see `LICENSE`). It bundles the third-party
**production** dependencies listed below. All are permissive
(MIT / ISC / Apache-2.0 / BSD) — there are **no copyleft (GPL/AGPL/LGPL) or
unlicensed** dependencies in the distributed application.

> Generated with `license-checker-rseidelsohn --production` on 2026-06-16.
> Regenerate after dependency changes:
> `npx license-checker-rseidelsohn --production --summary`.

## Summary

| License | Count |
|---------|-------|
| MIT | 27 |
| ISC | 6 |
| Apache-2.0 | 2 |
| BSD-3-Clause | 1 |
| MIT OR WTFPL | 1 |
| BSD-2-Clause OR MIT OR Apache-2.0 | 1 |

No GPL / AGPL / LGPL. No `UNLICENSED` / unknown.

## Key runtime components

| Component | License | Notes |
|-----------|---------|-------|
| Electron | MIT | App runtime (bundles Chromium + Node.js, themselves permissively licensed). |
| keytar | MIT | Native module — stores the GitHub token in the OS secure store. `asarUnpack`ed at build. |
| React / React-DOM | MIT | Dev dependency — **bundled into the renderer by Vite**, not shipped as `node_modules`. |

## Bundled production dependency inventory

| Package | Version | License |
|---------|---------|---------|
| `base64-js` | 1.5.1 | MIT |
| `bl` | 4.1.0 | MIT |
| `buffer` | 5.7.1 | MIT |
| `chownr` | 1.1.4 | ISC |
| `decompress-response` | 6.0.0 | MIT |
| `deep-extend` | 0.6.0 | MIT |
| `detect-libc` | 2.1.2 | Apache-2.0 |
| `end-of-stream` | 1.4.5 | MIT |
| `expand-template` | 2.0.3 | (MIT OR WTFPL) |
| `fs-constants` | 1.0.0 | MIT |
| `github-from-package` | 0.0.0 | MIT |
| `ieee754` | 1.2.1 | BSD-3-Clause |
| `inherits` | 2.0.4 | ISC |
| `ini` | 1.3.8 | ISC |
| `keytar` | 7.9.0 | MIT |
| `mimic-response` | 3.1.0 | MIT |
| `minimist` | 1.2.8 | MIT |
| `mkdirp-classic` | 0.5.3 | MIT |
| `napi-build-utils` | 2.0.0 | MIT |
| `node-abi` | 3.92.0 | MIT |
| `node-addon-api` | 4.3.0 | MIT |
| `once` | 1.4.0 | ISC |
| `prebuild-install` | 7.1.3 | MIT |
| `pump` | 3.0.4 | MIT |
| `rc` | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) |
| `readable-stream` | 3.6.2 | MIT |
| `safe-buffer` | 5.2.1 | MIT |
| `semver` | 7.8.4 | ISC |
| `simple-concat` | 1.0.1 | MIT |
| `simple-get` | 4.0.1 | MIT |
| `string_decoder` | 1.3.0 | MIT |
| `strip-json-comments` | 2.0.1 | MIT |
| `tar-fs` | 2.1.4 | MIT |
| `tar-stream` | 2.2.0 | MIT |
| `tunnel-agent` | 0.6.0 | Apache-2.0 |
| `util-deprecate` | 1.0.2 | MIT |
| `wrappy` | 1.0.2 | ISC |

(Most of the above are the transitive dependency tree of `keytar`'s
`prebuild-install`.)

## Not redistributed by shinylaunchR

The following are **run, not redistributed** — installed on the user's machine by
their own R, or hosted elsewhere — and so are not part of this project's
distribution:

- **R** (GPL-2 / GPL-3) — detected on the system or downloaded from CRAN onto the
  user's machine. See `NOTICE`.
- **Shiny** and any **user-registered R packages** (their own licenses, mostly
  GPL) — installed by the user's R from CRAN/GitHub at runtime.
- **Fonts** (Inter, JetBrains Mono — SIL OFL 1.1) — referenced by name with
  system fallbacks; font files are **not bundled**.

## Dev-only tooling

Build/test tooling (electron-builder, electron-vite, Vite, Vitest, TypeScript,
ESLint, etc.) is **not** shipped in the installer. Advisory status for that
tooling is tracked in `docs/dependency-advisories.md`.
