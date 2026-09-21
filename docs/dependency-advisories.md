# Dependency assessment — 2026-09-21

The 0.2.0-rc.1 lockfile uses Electron 44.4.3, electron-builder 26.15.3, electron-vite 5.0.0, Vite 7.3.6, Vitest 5.0.1, React 19.3.0, TypeScript 6.0.3 and ESLint 10.11.0. Node 24 is required for development and CI.

Versions were resolved from npm registry metadata, then checked with `npm ls`. Vite 7 and plugin-react 5 remain the latest compatible majors with electron-vite 5's declared Vite peer range. TypeScript 7 is outside typescript-eslint's `<6.1` support range, so TypeScript 6 is used. The obsolete ESLint React plugin does not support ESLint 10; TypeScript and React Hooks linting remain enabled with flat configuration.

The full npm audit and production-only audit both report **zero advisories at this checkpoint** following compatible audit fixes. This is a dated registry result, not a guarantee of vulnerability-free software. Receipts: `audit/2026-09-21/implementation/npm-audit-before.json`, `npm-audit-after.json`, and `npm-audit-production-after.json`. Recheck before release and on dependency/security updates.

Production-only audit alone is insufficient: Electron and React are declared development dependencies but their runtime and bundled code are shipped. Electron's Chromium/Node components and built artifact require review independently of npm's production dependency tree. keytar is no longer installed or shipped.

Primary compatibility and security guidance:

- [electron-vite migration guide](https://electron-vite.org/guide/migration)
- [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [Electron ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)
- [typescript-eslint supported versions](https://typescript-eslint.io/users/dependency-versions/)

Weekly dependency and action updates are configured. Each update must pass the same typecheck, lint, tests, build, fuse verification and packaged smoke checks. Signed macOS entitlements and real credential-store behavior remain separate qualification requirements.
