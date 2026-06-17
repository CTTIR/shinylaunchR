# shinylaunchR <img src="resources/icon.png" align="right" height="120" alt="shinylaunchR hex logo" />

A cross-platform desktop **launchpad for R/Shiny apps**. You see a grid of app
tiles grouped into three families — **Packages**, **Shiny apps**, and **Hosted
URLs** — each ending in its own **`+` tile**. Click a tile and the app opens in
its **own native desktop window** while R runs headless in the background.

- **Packages** — a Shiny app shipped as an R package (CRAN or a GitHub package
  repo); you name the package and its launcher function. Tiles use the package's
  real hex logo when it has one, else a **colored** hex.
- **Shiny apps** — non-package Shiny *files*: an uploaded `.zip`, a local folder,
  a zip URL, a gist, or a GitHub *source* repo (`app.R`, or `ui.R`+`server.R`).
  Files are staged into a private app directory and run with `shiny::runApp()`.
  Tiles use a **grey** hex.
- **Hosted URLs** — a Shiny app already running somewhere (shinyapps.io, Connect,
  …); opens the `https://` URL in an isolated window. Nothing is installed; tiles
  use a **grey** hex with a globe glyph.

The hex *shape* is the shared motif (it says "app"); the *colour* signals the
family — colored means a package, grey means everything else. A user-supplied
icon always overrides the generated hex.

shinylaunchR is **not** an R package — it is an Electron application that
*manages* R as a subprocess.

New here? Start with the [getting-started guide](docs/getting-started.md).

---

## The launchpad concept

- **`+`** to add an app: each section's `+` tile opens the Add dialog pre-set to
  that family. For a **package** you give the source (CRAN or GitHub `org/repo`),
  the R **package name**, and the **launcher function** (e.g. `mp_run_app`); for a
  **Shiny app** you upload a `.zip`, pick a local folder, or point at a zip
  URL / gist / GitHub source repo; for a **hosted URL** you just paste the
  `https://` address. Packages and Shiny apps install their dependencies into a
  private managed library and show live progress.
- **Click** a ready tile to launch: package and Shiny-file apps start R headless
  (waiting for the Shiny server) and open in a dedicated window with its own
  taskbar entry; a hosted URL opens its remote window directly.
- **Close** the window to stop that app's R process. Quitting shinylaunchR
  cleanly terminates every child process — no orphans.

A package launcher function is only ever called as a fully-qualified `pkg::fun()`
— validated against `^[A-Za-z.][A-Za-z0-9._]*$` and **never** interpolated into a
shell command; Shiny-file apps run via `shiny::runApp("<staged dir>")`. Uploaded
zips are extracted with built-in zip-slip protection, local folders are copied
(never run in place), and remote fetches are https-only.

---

## Download & Install (end users)

Grab the build for your OS from the repo's **[Releases](https://github.com/cttir/shinylaunchR/releases)**
page.

- **Windows** — download `shinylaunchR-Setup-<ver>.exe` (NSIS installer) and run
  it, or use the portable `.exe`. On first launch Windows SmartScreen may show
  *“Windows protected your PC”* → click **More info → Run anyway**.
- **macOS** — download `shinylaunchR-<ver>.dmg` and drag the app to Applications.
  On first launch: **right-click the app → Open → Open** (or System Settings →
  Privacy & Security → **Open Anyway**). Alternatively, clear the quarantine
  flag: `xattr -dr com.apple.quarantine /Applications/shinylaunchR.app`.
- **Linux** — AppImage: `chmod +x shinylaunchR-<ver>.AppImage` then run it; or
  `.deb`: `sudo apt install ./shinylaunchR-<ver>.deb`.

You also need **R ≥ 4.2**. shinylaunchR can use an R already on your system, or
(where configured) bootstrap a managed copy. See *R runtime* below.

### Why the security warning?

The app is safe but **unsigned** — code-signing certificates cost money and are
optional. The first-launch warning comes from your operating system (Gatekeeper
on macOS, SmartScreen on Windows), not from the app, and **no developer-side
build flag can disable it** — it is the OS protecting you. Signing/notarization
can be enabled later (see *Releasing*) to remove the prompt.

---

## How it works

```
Electron main process ── spawns ──▶ R subprocess (per launched app)
   • window management                • runs pkg::fun() on 127.0.0.1:<port>
   • R runtime manager                • headless, supervised
   • Shiny process supervisor         │ http
   • app registry (JSON)              ▼
   • validated IPC handlers      App BrowserWindow (native chrome, own icon)
```

R never blocks the UI: installs and launches run in supervised child processes
whose stdout/stderr stream to the in-app **Log Console** (with secret
redaction).

---

## Registering an app

| Field | Notes |
|-------|-------|
| **Display name** | Free text; shown under the tile. |
| **Source** | `CRAN` or `GitHub`. |
| **GitHub repo** | `org/repo` or `org/repo@ref` (GitHub only). Private repos use your stored token. |
| **Package name** | The R package. For GitHub it is auto-suggested from the repo but can differ — override it. |
| **Launcher function** | The function that starts the Shiny app, called as `pkg::fun()`. |
| **Icon** | Optional. Auto-resolved from the package's `figures/logo.png` (pkgdown/hex convention) if not supplied; otherwise a generated monogram tile. |
| **Port** | `Auto` (OS-assigned) or a fixed number. |

CRAN installs use `utils::install.packages()`; GitHub installs prefer
`pak::pak()` (falling back to `remotes::install_github()`), into the managed
library only — your system library is never touched.

---

## Where data lives

`userData` resolves per OS (Electron `app.getPath('userData')`):

- **Windows** — `%APPDATA%\shinylaunchR\`
- **macOS** — `~/Library/Application Support/shinylaunchR/`
- **Linux** — `~/.config/shinylaunchR/`

Inside it:

```
registry.json        registered apps
settings.json        preferences
icons/               cached tile icons
logs/shinylaunchR.log
r-runtime/           managed R (if bootstrapped) + library/
```

The GitHub token is **not** stored here — it lives in the OS secure store.

---

## R runtime

shinylaunchR uses a **bootstrap / managed** model:

1. On startup it looks for a managed R in `userData/r-runtime/`.
2. If absent, it falls back to detecting a **system R** on your `PATH`
   (or common locations).
3. You can **point it at any existing R** via *R Runtime → Point to existing R*.
4. A private library at `r-runtime/library/` keeps app packages isolated.

Download sources for the managed bootstrap are centralised in
`src/main/r-sources.json` (per platform + version, with optional `sha256`).
Automated download/extraction is intentionally gated behind a clear runtime
boundary so the app builds and runs without network access; if a source is
unavailable, install R yourself and point shinylaunchR at it. Target version:
**R 4.4.x**, minimum **R 4.2**.

> The app runs fine with **no R installed** — tiles show a clear state and the
> R Runtime panel explains the next step, rather than crashing.

---

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox` on every
  renderer. The renderer never touches Node or R directly.
- All privileged operations live in the main process and are exposed only
  through a minimal, typed `contextBridge` API in `preload.ts`.
- Every IPC argument is validated in the main process. `pkg`, `fun` and `repo`
  are checked against strict regexes; R is spawned with an **argument array**,
  never a shell command line. No user input is ever `eval`'d.
- The GitHub token is stored in the OS secure store (`keytar`), passed to the
  installer child process via a process-scoped `GITHUB_PAT` env var only, and
  redacted from all logs.

Runtime dependencies carry **no known vulnerabilities** (`npm audit --omit=dev`)
and **no copyleft licenses**. Remaining advisories are dev-tooling only and are
tracked, with rationale, in [`docs/dependency-advisories.md`](docs/dependency-advisories.md).

---

## Suite context

shinylaunchR was built to launch the **cttir / r-heller** package apps
(molpathR, phenoscapR, bamflowR, scimapR, …) but works with **any** R package
exposing a Shiny launcher function. Its look matches the suite's Hugo-Coder
aesthetic: dark-first, restrained, suite purple `#5E2C8E` accent, Inter + JetBrains
Mono.

---

## Build from source

```bash
npm install
npm run dev        # hot-reloading dev shell
npm run typecheck  # tsc --noEmit
npm run lint
npm run test       # vitest (no real R required)
npm run build      # bundles main/preload/renderer, then verify-build
npm run dist       # build + package for the current OS
npm run dist:win   # / dist:mac / dist:linux
```

App icons under `resources/` (`icon.png` / `icon.ico` / `icon.icns`) are the
branded blue play-hexagon mark. `scripts/gen-icons.mjs` remains as a fallback
placeholder generator but is not needed for normal builds.

---

## Releasing (maintainer)

Installers are built by CI — `electron-builder` cannot cross-compile all three
OSes from one machine (a macOS `.dmg` can only be built on macOS, etc.), so a
GitHub Actions matrix (`macos-latest` / `windows-latest` / `ubuntu-latest`)
produces them in parallel.

To cut a release:

```bash
# bump "version" in package.json and update CHANGELOG.md, then:
git tag v0.1.0
git push origin v0.1.0
```

The [`release` workflow](.github/workflows/release.yml) runs the quality gate
(`typecheck` / `lint` / `test`) on each OS, builds, and publishes the installers
to the GitHub Release for that tag:

- **Windows** — `shinylaunchR-Setup-<ver>.exe` (NSIS) + portable `.exe`
- **macOS** — `.dmg` (x64 + arm64) + `.zip`
- **Linux** — `.AppImage` + `.deb`

### Signing (optional — ships unsigned by default)

Builds are **unsigned** unless you add the signing secrets to the GitHub repo.
The same workflow then signs/notarizes automatically — no edits needed.

| Secret | Enables |
|--------|---------|
| `MAC_CSC_LINK` | base64 of your Apple Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |
| `WIN_CSC_LINK` | base64 of your Windows code-signing `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | the `.pfx` password |

macOS signing needs an Apple Developer ID ($99/yr) **plus** notarization;
Windows needs a code-signing certificate (EV clears SmartScreen immediately, OV
builds reputation over time). Never commit certificate material — it lives only
in repo secrets.

---

## Roadmap / known limitations

- **macOS signing & notarization** — the `.dmg` is produced unsigned. Set
  `CSC_LINK` / `CSC_KEY_PASSWORD` and configure notarization to ship signed.
- **Linux managed-R bootstrap** — distro-dependent; shinylaunchR currently
  relies on a system R on Linux. Document/extend `r-sources.json` as needed.
- **Automated managed-R download** — wired through `r-sources.json` with a clear
  boundary; the actual download/extract step is left as a runtime feature.
- **"also uninstall the R package"** on removal is recorded but conservative
  (the shared managed library is left intact to avoid breaking other apps).

## Use of LLM tools

Portions of this package were prepared with assistance from large language model
tooling for narrowly defined, non-authorial tasks: copyediting, prose smoothing,
Markdown/LaTeX formatting, scaffolding of boilerplate files (CI configs, build
scripts), code refactoring. The tools used were Chat AI, the LLM service of
KISSKI (GWDG), and a self-hosted Mistral Small (24B, Apache-2.0) run locally via
Ollama and the ollamar R package — local inference only, with no data sent to
third parties for the self-hosted model.

## Legal & compliance

- **License:** Apache License 2.0 (see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE)).
  Ownership and the commercial/dual-license path are explained in
  [`LICENSING.md`](LICENSING.md).
- **Third-party licenses:** all bundled dependencies are permissive
  (MIT/ISC/Apache/BSD) — inventory in
  [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
- **R & Shiny (GPL):** shinylaunchR *orchestrates* R — it spawns R as a separate
  process and talks to the Shiny server over a local socket; it does **not**
  link, embed, or redistribute R or Shiny. R is detected on your system or
  downloaded from CRAN onto your machine; Shiny and your packages are installed
  by your own R. Details in [`NOTICE`](NOTICE).
- **Privacy:** no telemetry; all data is local. See [`PRIVACY.md`](PRIVACY.md).
- **Security:** reporting and posture in [`SECURITY.md`](SECURITY.md).

> This documentation is legal *hygiene*, not legal advice and not a lawyer's
> sign-off. For commercial or large-scale public distribution, have a qualified
> IP/OSS lawyer review.

### Trademarks & non-affiliation

shinylaunchR is an independent open-source project. It is **not affiliated with,
endorsed by, or sponsored by** Posit Software, PBC (RStudio), the R Foundation,
or the maintainers of Shiny. "R", "RStudio", "Posit", and "Shiny" are trademarks
of their respective owners, used here only descriptively. No third-party logos or
marks are used; the app icon is original work.

## Citation

If you use shinylaunchR in your work, please cite it:

> Heller, R. (2026). *shinylaunchR: A cross-platform desktop launchpad for
> R/Shiny apps* (Version 0.1.0) [Computer software]. Apache-2.0.
> https://github.com/cttir/shinylaunchR

BibTeX:

```bibtex
@software{heller_shinylaunchr_2026,
  author  = {Heller, Raban},
  title   = {{shinylaunchR}: A cross-platform desktop launchpad for {R}/{Shiny} apps},
  year    = {2026},
  version = {0.1.0},
  url     = {https://github.com/cttir/shinylaunchR},
  license = {Apache-2.0}
}
```

## License

Licensed under the **Apache License, Version 2.0** — Copyright © 2026 Raban
Heller ([ORCID 0000-0001-8006-9742](https://orcid.org/0000-0001-8006-9742)).
See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and [`LICENSING.md`](LICENSING.md).
