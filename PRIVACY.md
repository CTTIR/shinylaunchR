# Privacy

shinylaunchR has no application telemetry or analytics service. This does not mean all data stays local: installed R code, hosted sites and dependency tools can communicate over the network.

The local Electron user-data directory stores registry/settings and recovery files, icons, logs, staged apps (`apps/`), a process ledger (`running-pids.json`), managed R package libraries and encrypted credential storage when safeStorage is available. Logs can include application output, local paths and sensitive data. Token redaction covers recognized credentials but cannot guarantee arbitrary output is confidential.

Network activity can include:

- The main process fetching HTTPS ZIP archives, GitHub zipballs and gists supplied during registration, and package/icon resources where configured.
- R installers contacting the configured CRAN mirror, GitHub and dependency repositories. GitHub tokens may be supplied to authenticated install operations.
- Local Shiny servers on loopback and any connections made by the R application itself.
- Hosted HTTPS pages contacting their operators, authentication providers and other resources. Their privacy policies apply to entered data.

Hosted windows use temporary, non-persistent sessions by default. The launcher does not provide a managed R download or an automatic update service.

Tokens are encrypted via Electron safeStorage and written locally when a usable OS backend exists. On Linux basic_text is rejected. Encryption does not isolate secrets from malicious code running as the same OS account. Legacy migration uses native OS helpers to read only service `shinylaunchR`, account `github-pat` (Windows target `shinylaunchR/github-pat`); keytar is not shipped. Migration deletes the old item only after saving the encrypted copy. Missing helpers leave the old store uninspected and untouched; the log explains how to restore migration. Failed access or deletion is reported without copying helper output into logs.

Removing an app is not a secure erase of backups, logs, OS caches, remotely submitted data or external app data. Review and back up your local files before removing the user-data directory. Share only redacted diagnostics and never include access tokens in bug reports.
