# shinylaunchR

A cross-platform desktop **launchpad for R/Shiny apps**. You see a grid of app
tiles; a **`+` tile** registers a new Shiny app (from CRAN or GitHub) by naming
its package and launcher function. Click a tile and the app opens in its **own
native desktop window** while R runs headless in the background.

> ![screenshot placeholder](resources/icon.png)
>
> *(screenshot placeholder — a dark, Hugo-Coder-styled grid of app tiles)*

shinylaunchR is **not** an R package — it is an Electron application that
*manages* R as a subprocess.

---

## The launchpad concept

- **`+`** to add an app: choose a source (CRAN package or GitHub `org/repo`),
  the R **package name**, and the **launcher function** the package exposes
  (e.g. `mp_run_app`). shinylaunchR installs the package into a private managed
  library and shows live progress.
- **Click** a ready tile to launch: shinylaunchR starts R headless, waits for
  the Shiny server, and opens the app in a dedicated window with its own
  taskbar entry.
- **Close** the window to stop that app's R process. Quitting shinylaunchR
  cleanly terminates every child process — no orphans.

The launcher function is only ever called as a fully-qualified `pkg::fun()` —
it is validated against `^[A-Za-z.][A-Za-z0-9._]*$` and **never** interpolated
into a shell command.

---

## Install (end users)

Download the artifact for your OS from the Releases page:

- **Windows** — `shinylaunchR-Setup-x.y.z.exe` (NSIS installer) or the portable
  `.exe`.
- **macOS** — `shinylaunchR-x.y.z.dmg` (unsigned; see *Known limitations*).
- **Linux** — `shinylaunchR-x.y.z.AppImage` or the `.deb`.

You also need **R ≥ 4.2**. shinylaunchR can use an R already on your system, or
(where configured) bootstrap a managed copy. See *R runtime* below.

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

Icons under `resources/` are generated placeholders (`node scripts/gen-icons.mjs`);
replace them with branded assets before release.

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

## License

MIT © 2026 Raban Heller ([ORCID 0000-0001-8006-9742](https://orcid.org/0000-0001-8006-9742)).
