# Third-party components

Inventory checkpoint: 2026-09-21, unpublished 0.2.0-rc.1 candidate. Versions come from the committed npm lockfile. This summary does not replace the license notices included in distributions.

| Shipped component | Version | License / notice |
| --- | --- | --- |
| Electron | 44.4.3 | MIT; distribution also includes Chromium, Node.js and their third-party notices |
| React | 19.3.0 | MIT; bundled in renderer |
| React DOM | 19.3.0 | MIT; bundled in renderer |
| Scheduler (React dependency) | See package-lock.json | MIT; bundled when used by React DOM |
| Application source | 0.2.0-rc.1 | Apache-2.0; LICENSE and NOTICE |

Electron's distribution `LICENSE` and `LICENSES.chromium.html` must be retained in packaged artifacts. Chromium contains components under multiple licenses; no blanket claim that every artifact component is permissively licensed is made here. Review the complete built artifact notices before redistribution.

Build/test tools include electron-builder (MIT), electron-vite (MIT), Vite (MIT), Vitest (MIT), TypeScript (Apache-2.0), ESLint (MIT), Testing Library (MIT), jsdom (MIT), and @electron/fuses (MIT), with their transitive dependencies recorded in package-lock.json. These tools are not automatically part of the shipped app merely because they are in the lockfile. Bundled source and Electron are shipped despite being classified as devDependencies.

keytar is no longer a package dependency. Credential encryption uses Electron safeStorage. Legacy migration uses native OS helpers (`security`, `secret-tool`, Windows Credential Manager via PowerShell); helper availability and credential access must be qualified on the target OS.

R, Shiny and user-selected R packages are separately installed and governed by their own licenses (R and Shiny include GPL terms). shinylaunchR does not bundle an R distribution. Check the licenses of all applications, data and dependencies that you distribute alongside it.
