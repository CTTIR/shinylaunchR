# Privacy

_Last reviewed: 2026-06-16. This is good-practice disclosure, not legal advice._

## No telemetry

**shinylaunchR collects no analytics and no telemetry.** It contains no analytics
SDK, no crash reporter, and no usage tracking. This was verified in the source:
the only outbound network code in the app is the GitHub token test and a local
readiness probe (see below).

## Network requests

shinylaunchR only makes network requests as a direct result of something **you**
do:

| When | Endpoint | Why |
|------|----------|-----|
| You install/register an app | **CRAN** (`cloud.r-project.org` by default) or **GitHub** | Your R installs the package you chose, into the app's managed library. Performed by your R, not by shinylaunchR directly. |
| You add a GitHub-sourced app, or click **Test token** | **api.github.com** | Authenticates with the token you provided (private repos / rate limits). |
| You open an app | **`http://127.0.0.1:<port>`** | Loads the Shiny server running locally on your own machine. |
| You add a hosted/remote app URL | that URL | Loads the remote app you explicitly added. |
| (Managed-R model) first-run R setup | **CRAN** | Downloads an official R build to your machine over HTTPS, checksum-verified. shinylaunchR does not redistribute R. |

There are **no background calls**, no "phone home", and no auto-update check baked
into the app itself (see *Updates*).

## Where your data lives (all local)

shinylaunchR stores everything under your OS user-data directory
(`app.getPath('userData')`):

- **Windows** — `%APPDATA%\shinylaunchR\`
- **macOS** — `~/Library/Application Support/shinylaunchR/`
- **Linux** — `~/.config/shinylaunchR/`

Contents:

- `registry.json` — the apps you registered (names, package/function, source).
- `settings.json` — your preferences (theme, ports, CRAN mirror, etc.).
- `icons/` — cached tile icons.
- `logs/shinylaunchR.log` — local diagnostic log (secrets are redacted).
- `r-runtime/` — the managed R library, if used.

None of this is transmitted anywhere by shinylaunchR.

## GitHub token

If you add a GitHub Personal Access Token, it is stored in your **operating
system's secure store** (`keytar` → Windows Credential Vault / macOS Keychain /
Linux libsecret) — **never** in the JSON files above and never in logs (it is
redacted from all log output). The token is sent **only** to GitHub, and only for
operations you trigger: testing the token, and installing from a GitHub repo
(where it is passed to your R's installer as a process-scoped `GITHUB_PAT`
environment variable). It is never sent to any other party and never to a
shinylaunchR-operated server (there is none).

## Hosted / remote apps

If you register a Shiny app hosted on a remote URL, your use of that app is
governed by **that service's own privacy policy and terms** — it is outside
shinylaunchR's control and shinylaunchR does not proxy or inspect that traffic.

## Updates

shinylaunchR does not auto-update itself or check for updates in the background.
Releases are published to the project's GitHub Releases page; you choose when to
download a new version. (The release *build* pipeline uploads artifacts to GitHub,
but the installed app does not contact GitHub for updates on its own.)

## Changes

If a future version adds any telemetry or crash reporting, it will be disclosed
here and will be off-by-default / clearly opt-in.
