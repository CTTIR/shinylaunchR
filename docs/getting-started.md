# Getting started with shinylaunchR

shinylaunchR is a cross-platform desktop **launchpad for R/Shiny apps**. It shows
a grid of app tiles; clicking one opens that app in its own native window while R
runs headless in the background. shinylaunchR is **not** an R package — it is an
Electron application that *manages* R as a subprocess.

## Install

Download the installer for your platform from the
[Releases page](https://github.com/cttir/shinylaunchR/releases) and run it. The
app ships unsigned by default, so your OS may show a warning on first launch —
see the README's *Why the security warning?* section.

## The three app families

Each section ends in its own **`+` tile** that opens the Add dialog pre-set to
that family.

- **Packages** — a Shiny app shipped as an R package (CRAN or a GitHub package
  repo). You provide the source, the package name, and the **launcher function**
  (e.g. `mp_run_app`), which is called as `pkg::fun()`. Tiles use the package's
  real hex logo when it has one, otherwise a colored hex.
- **Shiny apps** — non-package Shiny *files*: an uploaded `.zip`, a local folder,
  a zip URL, a gist, or a GitHub *source* repo (`app.R`, or `ui.R` + `server.R`).
  Files are staged into a private directory and run with `shiny::runApp()`.
- **Hosted URLs** — a Shiny app already running somewhere (shinyapps.io, Connect,
  …). Paste the `https://` address; nothing is installed.

## Add and launch an app

1. Click **`+ Add app`** (or the `+` tile in a section).
2. Pick a source and fill in the required fields for that family.
3. For packages and Shiny-file apps, shinylaunchR installs dependencies into its
   private managed library and shows live progress in the log console.
4. When the tile turns green, **click** it to launch. The app opens in a
   dedicated window with its own taskbar entry; R runs headless behind it.
5. **Close** the window to stop that app's R process.

Only add Shiny-file and hosted-URL apps you trust — their R code runs, or their
remote page loads, when launched.

## R runtime

shinylaunchR detects R on your system or downloads a managed copy from CRAN onto
your machine. Use **R Runtime** in the menu to check status, (re-)bootstrap a
managed R, point at an existing installation, or open the library folder.

## Where to look next

- **Help → Version, Legal & License** in the top menu links to the version,
  legal notices, reference documentation, third-party licenses, and the license.
- Dependency and supply-chain notes: [`dependency-advisories.md`](dependency-advisories.md).
- Security posture and reporting: [`../SECURITY.md`](../SECURITY.md).
- Privacy (no telemetry; all data local): [`../PRIVACY.md`](../PRIVACY.md).

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
  note    = {ORCID: 0000-0001-8006-9742},
  license = {Apache-2.0}
}
```
