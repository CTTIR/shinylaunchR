# shinylaunchR

A desktop launchpad for R and Shiny applications, with package apps, staged Shiny source apps, and hosted HTTPS URLs. Click a tile to select it; double-click or press Enter to launch it in its own native window.

**0.2.0-rc.1 is an unpublished release candidate.** Windows, macOS and Linux are build targets; full platform qualification remains pending. A configured CI job is not evidence of a successful platform run.

## Getting started

Install R ≥ 4.2 separately for package and source apps, then select it in **R Runtime → Point to existing R** if discovery does not find it. There is no managed R download. Hosted URLs do not need local R. See the [getting-started guide](docs/getting-started.md).

Each section's **+** tile opens the registration form:

- **Packages:** choose CRAN or GitHub, the package name and its exported launcher function. The launcher is called as `pkg::fun()`.
- **Shiny apps:** choose a folder, ZIP file, HTTPS ZIP URL, gist or GitHub source repository containing `app.R` or `ui.R` and `server.R`. Local files are copied into staging; editing the original does not update the staged app.
- **Hosted URLs:** enter an HTTPS address. These windows use temporary sessions; persistent login storage is not offered.

Select a tile before using native menu actions. Close a running app window or use Stop to request process shutdown. Repeated launches focus an existing app window. Quitting requests shutdown of owned processes; platform-specific process termination still requires qualification.

Only install sources you trust. **R packages and Shiny source execute code with your operating-system account's permissions.** A managed package library is not a sandbox. Hosted applications can transmit entered data to their operators and third-party services.

## R libraries and application data

Packages share a library scoped by R version and architecture. They do not have independent `renv` environments. Declared dependencies are requirements; inferred references are advisory. When the pak preference is enabled, the installer prefers `pak::pkg_install` for CRAN and GitHub, with the available fallback path. Package uninstall must respect other registered apps using the package.

Reinstall replaces staged source files. Keep databases, uploads and other durable app data outside the staged source directory and back them up before reinstalling. Transactional replacement protects the last usable source from an installation failure; it is not a backup service for app-written data.

The Electron `userData` directory typically lives at `%APPDATA%/shinylaunchR` (Windows), `~/Library/Application Support/shinylaunchR` (macOS), or `~/.config/shinylaunchR` (Linux). It contains registry and settings JSON, recovery backups, cached icons, logs, `apps/` staging, `running-pids.json`, the versioned R library beneath `r-runtime/`, and encrypted credential storage when available. Paths may differ with system configuration.

Package icons are resolved from installed `help/figures/logo.*` and other supported locations. User-selected icons take priority. The interface uses the R-blue `#75AADB` accent.

## Credentials and security

GitHub tokens use Electron `safeStorage` when a usable OS encryption backend is available. Linux `basic_text` is treated as unavailable. The encrypted token file is local; this does not protect against code running as your account. Legacy keytar tokens can be imported through fixed native OS helpers without shipping keytar: macOS `security`, Linux `secret-tool`, and Windows Credential Manager via PowerShell. Linux may require installation of the libsecret tools package. Missing helpers produce a warning and leave the old OS item untouched; enter the token again or restore the helper to migrate it. Locked stores and failed deletions are reported. These adapters require real-platform credential-store qualification.

App windows use sandboxed renderers without Node integration. Main-process IPC handlers validate requests and sender identity; browser permission requests are denied by default. Token redaction is defense in depth, not a guarantee that arbitrary app output cannot expose secrets. See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Building and checking

Use Node.js 24 LTS and the committed lockfile:

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run package:dir
```

`package:dir` creates an unpacked application for the host platform and verifies its Electron fuse policy. Run `node scripts/smoke-packaged.mjs <packaged-executable>` to exercise the isolated smoke mode; Linux CI uses Xvfb. No smoke run should use the normal user-data directory.

PR CI runs checks, packaging and smoke on Linux, Windows and macOS. Dependencies and workflow action pins receive weekly update PRs. The current compatible toolchain and dated audit evidence are described in [dependency-advisories.md](docs/dependency-advisories.md). npm's production-only audit excludes Electron and bundled renderer libraries because they are build dependencies; it is not a complete shipped-artifact assessment.

## Release qualification

The [release workflow](.github/workflows/release.yml) builds installers on version tags without publishing from individual platform jobs. Only after all platform checks and host-architecture packaged smoke runs pass does a separate job create a draft; candidate versions are marked prerelease. A maintainer must review and publish the draft. Tag and package/lockfile/CITATION/Zenodo versions must agree. Before tagging, review the qualification evidence, align package/CITATION/Zenodo/changelog metadata, and assign the actual publication date. This candidate has no assigned release date or new DOI. Existing archived software is available at [Zenodo](https://doi.org/10.5281/zenodo.21889984); that DOI is not asserted to describe this unpublished candidate.

Builds are unsigned unless signing credentials are configured. Unsigned software may trigger OS warnings; that is not evidence of safety. macOS uses `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; Windows uses `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. Certificate and notarization behavior require separate signed-artifact testing. Never commit certificates or tokens.

Packaging removes sourcemaps and sets Electron fuses to disable RunAsNode, NODE_OPTIONS and CLI inspection, while requiring ASAR loading and enabling embedded ASAR integrity where supported. The macOS entitlement set is reduced to JIT; signed macOS qualification is still pending.

Managed R installation, per-app renv libraries, persistent hosted sessions, frameless windows and automatic updates are not offered in this candidate.

## License and citation

Copyright © 2026 Raban Heller ([ORCID](https://orcid.org/0000-0001-8006-9742)). Licensed under Apache-2.0; see [LICENSE](LICENSE), [NOTICE](NOTICE), [LICENSING.md](LICENSING.md), and [third-party notices](THIRD_PARTY_LICENSES.md). R and Shiny are separate installations; their packages and applications have their own licenses. This project is independent of the R Foundation and Posit.

For the unpublished candidate, cite version `0.2.0-rc.1` and its eventual revision identifier rather than an invented release date. The published archive has DOI `10.5281/zenodo.21889984`:

```bibtex
@software{heller_shinylaunchr,
  author = {Heller, Raban},
  title = {{shinylaunchR}: Desktop launchpad for {R} and {Shiny} applications},
  doi = {10.5281/zenodo.21889984},
  url = {https://github.com/CTTIR/shinylaunchR}
}
```
