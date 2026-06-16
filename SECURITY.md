# Security Policy

## Reporting a vulnerability

If you discover a security issue in shinylaunchR, please report it privately
rather than opening a public issue:

- Use GitHub's **[Report a vulnerability](https://github.com/cttir/shinylaunchR/security/advisories/new)**
  (Security → Advisories) on the repository, or
- Email the maintainer: **raban.heller@outlook.com** (subject:
  `shinylaunchR security`).

Please include the version, your OS, reproduction steps, and the impact you
observed. We aim to acknowledge reports within a few days and to address
confirmed, in-scope issues in a timely follow-up release. Please allow a
reasonable period for a fix before public disclosure.

## Scope

In scope: the Electron application itself — the main process, the preload bridge,
IPC validation, process spawning, credential handling, and the packaged build.

Out of scope: vulnerabilities in **R**, **Shiny**, or the R packages a user
chooses to install (report those upstream), and in third-party hosted apps a user
registers.

## Security posture (summary)

shinylaunchR is built with a defensive posture, verified in a dedicated audit:

- **Renderer isolation** — every `BrowserWindow` runs with `contextIsolation:
  true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`. The
  renderer reaches privileged operations only through a minimal, typed
  `contextBridge` API in the preload script.
- **Validated IPC** — every IPC argument is validated in the main process.
  Package, function, and repo names are checked against strict allow-list
  regexes.
- **No shell injection** — R is spawned with an argument array (never a shell
  string); the launcher is only ever invoked as a fully-qualified `pkg::fun()`.
  No `eval`, no `shell: true`, no `exec` with interpolated input.
- **Navigation guards** — windows cannot navigate away from their own origin;
  external links open in the system browser, https only.
- **Credentials** — the GitHub token lives in the OS secure store, is passed to
  child processes only via a process-scoped env var, and is redacted from all
  logs. It never crosses to the renderer in plaintext.
- **Verified downloads** — any managed-R download requires an HTTPS source and a
  SHA-256 checksum before use.

See `NOTICE`, `PRIVACY.md`, and `docs/dependency-advisories.md` for related
disclosures.

## Unsigned builds

Release builds are **unsigned** by default, so first launch shows an OS prompt
(Gatekeeper on macOS, SmartScreen on Windows). This is the OS protecting the
user, not a defect; see the README for the documented steps. Signing can be
enabled later via the opt-in CI secrets.
