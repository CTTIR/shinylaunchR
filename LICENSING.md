# Licensing & ownership

_Plain-language summary. This is hygiene, not legal advice — consult a qualified
IP/OSS lawyer before a commercial launch._

## License

shinylaunchR is released under the **Apache License, Version 2.0** (see
[`LICENSE`](LICENSE)). Apache 2.0 lets anyone use, modify, and redistribute the
software under its terms, grants an explicit **patent license**, and requires
downstream redistributors to preserve the [`NOTICE`](NOTICE) attributions.

## Ownership

**Raban Heller is the sole copyright owner.** Apache 2.0 licenses the *use* of the
software to others; it does **not** transfer ownership. Every first-party source
file carries an SPDX header (`SPDX-License-Identifier: Apache-2.0`) under that
copyright.

## Selling binaries & dual licensing

As the rights holder, the owner may:

- **Distribute and sell compiled binaries** (Windows/macOS desktop now, mobile
  later). Apache 2.0 explicitly permits commercial distribution.
- **Offer the software under a separate commercial license / EULA** in addition
  to Apache 2.0 (a "dual-licensing" model) at any time — for example, a paid,
  signed, supported build with different warranty/support terms. The owner can do
  this precisely because they hold the copyright; the Apache grant to the public
  does not preclude the owner from also licensing the same code commercially.

If external contributions are ever accepted, they come in under Apache 2.0 by
default (§5). To keep the dual-licensing option clean, consider requiring a
Contributor License Agreement (CLA) or a Developer Certificate of Origin before
accepting outside contributions — see *Follow-ups*.

## Honest note on "building from source"

Apache 2.0 (like any OSI license) lets others compile the software themselves
from this source. The commercial value here is in the **signed, notarized,
supported, convenient binaries** — not in preventing source compilation. If
preventing third-party builds ever becomes a hard requirement, that is a move to
a proprietary or source-available license, which is a separate relicensing
decision and is **not** what this document does.

## Trademarks

Per Apache 2.0 §6, the license does **not** grant rights to the "shinylaunchR"
name or marks — that protects the product name. Separately, shinylaunchR makes
only nominative use of third-party marks (R, RStudio, Posit, Shiny) and is not
affiliated with their owners; see [`NOTICE`](NOTICE).

## Follow-ups (optional, owner's decision)

- Add a `CONTRIBUTING.md` + CLA/DCO if accepting external contributions.
- Draft a commercial EULA when you begin selling (the dual-license path above).
- Have counsel review before a commercial or large-scale public launch.
