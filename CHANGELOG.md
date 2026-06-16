# Changelog

All notable changes to shinylaunchR are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
