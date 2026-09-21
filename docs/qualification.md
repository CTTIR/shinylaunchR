# Candidate qualification

Candidate: **0.2.0-rc.1**, assessed 2026-09-21. This is not a signed final release.

## Executed checks

The application source at `ea683c1400295a1f1ea94c5a2b3987b6a16a0d90` is exercised by [the three-platform qualification run](https://github.com/CTTIR/shinylaunchR/actions/runs/35624732071). Consult each job result and its downloadable receipts for the exact runner, architecture, checks and outcomes. The pipeline runs types, lint, regression tests, fresh CRAN and pak libraries, a real Shiny HTTP lifecycle, packaging/fuse verification, and sandboxed renderer checks. Native process tests run on their respective platforms; platform-specific skips are reported.

Local Linux validation passed 224 regression tests; four default-suite skips cover two opt-in R integration tests and two Windows-native tests. Separate real-R integration passed. The Debian package was installed over 0.1.0; the installed application archive matched the tested build, and the installed executable passed sandboxed checks.

Packaged checks exercise actual notification denial, blocked navigation/popups, rejection of foreign-renderer IPC, native keyboard modal interactions, and eight dark/light accessibility views. Automated axe checks reported no violations; incomplete/manual checks are not considered passed.

An isolated Linux keyring test migrated a synthetic legacy token, verified encrypted disk storage, restored it in a separate process, and removed it. No personal token was used. A separate private display running Orca verified the AT-SPI application tree, accessible Add app action, dialog role and focused control. This is integration evidence, not a human screen-reader usability certification.

## Requirements before a final release

- Exercise signed Windows and signed/notarized macOS artifacts, including the reduced macOS entitlements. Signing credentials are not configured in the repository.
- Qualify Windows/macOS native credential stores and locked-backend behavior with disposable credentials.
- Complete clean-install, upgrade and uninstall checks for every distributed installer and architecture, including GUI-start R discovery, missing/custom R and runtime changes. Current Linux upgrade evidence and host-architecture CI do not cover every artifact.
- Exercise a controlled private GitHub installation, including authentication failure and cancellation. Public R/pak success and request-routing regressions do not establish this result.
- Complete human screen-reader and keyboard usability review on the supported desktop platforms.
- Review final metadata, publication date and version-specific archive DOI when cutting the release. No new DOI or publication date is asserted for this candidate.

Managed libraries are shared within an R version/architecture. Source replacement uses directory swaps and rollback but is not a fully journaled multi-file transaction across power loss. R discovery uses common locations and an explicit picker rather than executing login-shell startup files. These are the documented operating boundaries.

Detailed local receipts, rollback archives and the merged finding ledger are retained in the Git-ignored `audit/2026-09-21/` directory. They must be transferred separately and can include sensitive user-data backups; do not publish that directory.
