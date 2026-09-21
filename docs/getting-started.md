# Getting started

This guide describes the unpublished 0.2.0-rc.1 candidate. Check the release's platform qualification before distributing installers.

1. Install R ≥ 4.2 separately if you want local package or source apps. The launcher does not download R. Use **R Runtime → Point to existing R** when automatic discovery does not find your installation.
2. Use a section's **+** tile to register a package, Shiny source app, or hosted HTTPS URL. For a package, provide its name and exported launcher function. For source apps, choose a folder, ZIP, HTTPS archive, gist, or GitHub source repository. Hosted URLs need no local R.
3. Click a tile to select it. Double-click or press Enter to launch. Native menu actions target the selected tile.
4. Use Stop or close the app window when finished. Quit requests shutdown of owned processes.

Only install trusted R code: it runs with your account's permissions. Local folders are copied into staging and are not run in place. Reinstall replaces staged files, including app-written files there; keep durable data elsewhere. Apps share an R-version/architecture library, not per-app renv environments.

Credentials use Electron safeStorage only when a usable OS backend exists. Linux basic_text is unavailable. Hosted windows use temporary sessions, so logins may need to be repeated. Frameless windows and managed R installation are not offered.

If a launch fails, inspect the Log Console, verify the selected R runtime and dependency installation, and retry after resolving the reported error. Logs can contain app output and paths; inspect them before sharing. See [privacy](../PRIVACY.md), [security](../SECURITY.md), and the [README](../README.md).
