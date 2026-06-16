# Changelog

All notable changes to shinylaunchR are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Three app families.** Apps are grouped into **Packages** (CRAN / GitHub
  package), **Shiny apps** (non-package files), and **Hosted URLs**, derived from
  `source.kind` via a single `appFamily()` helper.
- **Shiny apps as files.** Add non-package Shiny apps by uploading a `.zip`,
  picking a local folder, or pointing at a zip URL / gist / GitHub *source* repo.
  Files are staged under `userData/apps/<id>/` (extracted/copied, never run in
  place), the entry (`app.R`, or `ui.R`+`server.R`, honoring an app sub-directory)
  is located, dependencies are scanned and installed, and the app runs via
  `shiny::runApp()`.
- **Hosted URLs.** Register an already-running Shiny app by its `https://` URL;
  it opens in an isolated (per-app, non-persistent partition), no-preload,
  https-only window with nothing installed.
- **Grouped dashboard.** Three labeled, divided sections — each ending in its own
  family-preset `+` tile — replace the single grid; the Add dialog adapts its
  fields to the chosen family.
- **Family-colored hex icons.** A hex is the shared tile motif; colour signals the
  family (colored = package with its real logo or a generic colored hex; grey =
  Shiny file / hosted URL, with a globe glyph for URLs). A user icon overrides.
- **Dependency-free zip extraction** (built-in `zlib`) with zip-slip protection.
- **Trust confirmation** before adding a Shiny-file or hosted-URL app.
- **Pre-launch dependency probe** for Shiny-file apps (the source analogue of the
  package load gate).

### Changed
- `pkg`/`fun` are now optional and required only for the Packages family; existing
  `cran`/`github` registry entries migrate into Packages unchanged.

### Fixed
- Package hex auto-resolve: the R probe's statements were joined with a space
  (invalid R, silent failure) — now newline-joined.
- Source dependency installs are resilient to scan false positives: a batch
  install falls back to per-package `tryCatch`, so one unresolvable name can't
  abort the whole install.
- Remote fetches (zip URL / gist / GitHub source) now time out instead of hanging
  staging indefinitely.

## [0.1.0] - 2026-06-16

Initial release.

### Added
- Electron + React + TypeScript desktop shell, bundled with electron-vite.
- Dashboard grid of app tiles with a `+` tile to register apps; status dots
  (not-installed / installing / ready / running / error), selection, and a
  per-tile context menu.
- Register/Edit dialog with inline validation for CRAN and GitHub sources,
  launcher-function regex checks, optional icon, and Auto/Fixed port.
- App registry persisted to `registry.json` with schema validation and
  corrupt-file recovery (backup + reset).
- R Runtime Manager: locate (managed → custom → system), version check, and a
  best-effort managed-R bootstrap configured via `r-sources.json`.
- Installer for CRAN (`install.packages`) and GitHub (`pak`/`remotes`) into a
  private managed library, with streamed, redacted logs.
- Shiny supervisor: spawns one headless R per app, polls for readiness, opens a
  native app window, and kills the whole process tree on stop/quit.
- Icon resolution from package logos (pkgdown/hex convention) with a generated
  monogram fallback.
- GitHub PAT management via the OS secure store (`keytar`) with masked display,
  a "Test token" check, and `GITHUB_PAT`-only propagation to child processes.
- Native application menu (File/Edit/Run/View/R Runtime/Settings/Credentials/Help)
  mirrored by in-window affordances; dark/light/system theming (Hugo Coder look).
- Log Console drawer, Settings, R Manager, Credentials and Help/About panels.
- Security posture: context isolation, no node integration, validated IPC,
  argument-array R spawning.
- Unit tests for port discovery/readiness, registry CRUD/validation/recovery,
  and R version parsing/path resolution (no real R required).
- electron-builder targets: Windows (NSIS + portable), macOS (dmg, unsigned),
  Linux (AppImage + deb); `verify-build` post-build smoke check.
