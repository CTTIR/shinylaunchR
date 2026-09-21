# Security

Report suspected vulnerabilities privately through the repository's GitHub security reporting facility when available, or to the maintainer at raban.heller@outlook.com. Include a minimal reproduction and affected version; do not include real credentials or private datasets in public issues.

The unpublished 0.2.0-rc.1 candidate is undergoing qualification. Platform, credential-store, packaged-app, signing and screen-reader qualification remains pending.

Electron renderers use context isolation, no Node integration and sandboxing. Privileged operations are exposed through a limited preload bridge, with main-process validation of arguments and sender identity. Permission requests are denied by default. Local app navigation is constrained by origin; hosted HTTPS pages remain remote content and can contact external services.

Imported app specifications are untrusted. Registry normalization, managed-path checks, bounded downloads/extraction and transactional staging reduce specific attack and failure paths. They do not make an arbitrary R package or source app safe. R code executes as the user, can read local files and can make network requests; shared libraries do not isolate apps from each other.

Tokens use Electron safeStorage when an OS backend is available; Linux basic_text is rejected. Stored tokens and recognized token forms are registered for log redaction. Redaction cannot guarantee confidentiality of transformed, encoded or application-specific secrets. Local account compromise defeats this boundary.

Packaged binaries disable RunAsNode, NODE_OPTIONS and CLI inspection with Electron fuses. ASAR-only loading and embedded integrity are enabled; integrity checking is supported by Electron on Windows/macOS. Packaging excludes sourcemaps. macOS entitlements retain JIT only, pending signed-app qualification. Neither fuses nor code signing establish that installed R code is trustworthy.

Only a dated full dependency audit and artifact review support a release assessment. A zero production-only npm audit omits development-classified Electron and bundled React. See [dependency-advisories.md](docs/dependency-advisories.md). Unsigned builds may trigger operating-system warnings and have no signed publisher assurance.
