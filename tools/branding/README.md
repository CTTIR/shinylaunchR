# Package branding

CTTIR Coder Edition v5, supplied 25 October 2026. Editable native R geometry
and `design_tokens.csv` define the artwork, topic colours and typography.
Every identity has an artwork-only hex and a named composition with the exact
package name inside the hex, each in light, dark and grayscale modes.

Both master compositions are 1600 by 1848 pixels. Published standard exports
are copied byte-for-byte from the approved v5 library in hexmakR. Their font
outlines are preserved regardless of the fonts installed on the machine.

Render into a separate review directory from the repository root:

```sh
Rscript tools/branding/render.R /path/to/review
```

Regenerate and replace the registered repository assets:

```sh
Rscript tools/branding/render.R --apply
```

`packages.csv` selects the identities; `assets.csv` maps the rendered filenames
to their repository destinations. The canonical package `logo` and
`logo-with-name` both use the named composition, including navigation, README
images, vignettes and application headers. Explicit `logo-symbol` and
`logo-noname` aliases retain the compact artwork-only composition. `-dark` and `-mono` select the alternate surfaces. Existing
consumer filenames remain available. Icons use the dark artwork at native
sizes; the maskable application icon includes its required opaque safe area.

The build script uses hexmakR 0.2.0 or later for approved masters, and base R,
grid, grDevices, utils and Cairo for additional platform icon sizes. It does
not add a runtime dependency to the package. Fonts and their licences are
retained in `fonts/OFL.txt` and `fonts/JetBrainsMono-OFL.txt`.

The shared themakR template consumes the same v5 token and brand component
styles. Standalone vignette styling needs explicit adoption; installing a
package does not change its documentation theme or the user's font settings.

Source archive SHA-256:
`420401d00ab4c5eefdd74440d826b76282f3c1e5262c1f044fc0c6a052f6890e`

## Approved v5 masters

`render.R` requires hexmakR 0.2.0 or later. The supplied library is the
authority for the named hex, artwork-only hex and five standard icon sizes.
These files are copied without regenerating font outlines. Additional platform
icon sizes continue to use the bundled R motif renderer. `assets.csv` records
the intended variant for each destination; display logos use `lockup`, while
favicons and explicitly compact symbols use artwork-only variants.
