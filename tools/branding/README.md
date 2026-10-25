# Package branding

CTTIR Coder Edition v4.1, supplied 25 October 2026. Editable native R geometry
and `design_tokens.csv` define the artwork, topic colours and typography.
Every identity has an artwork-only hex and a named composition with the exact
package name below it, each in light, dark and grayscale modes.

Render into a separate review directory from the repository root:

```sh
Rscript tools/branding/render.R /path/to/review
```

Regenerate and replace the registered repository assets:

```sh
Rscript tools/branding/render.R --apply
```

`packages.csv` selects the identities; `assets.csv` maps the rendered filenames
to their repository destinations. The canonical package `logo` is artwork only
for navigation. `logo-with-name` is the named composition for README images and
static figures. `-dark` and `-mono` select the alternate surfaces. Existing
consumer filenames remain available. Icons use the dark artwork at native
sizes; the maskable application icon includes its required opaque safe area.

Rendering uses base R, grid, grDevices, utils and Cairo. No runtime dependency
or installation step is added to the package. Linux rendering uses only the
bundled fonts, with R's bold brand face mapped to JetBrains Mono SemiBold; this
corrects the supplied profile's possible selection of system fonts. On other
systems, install the bundled Inter and JetBrains Mono fonts first. Check a proof
because font and graphics versions can affect the result. Font licences are
in `fonts/OFL.txt` and `fonts/JetBrainsMono-OFL.txt`.

The shared themakR template consumes the same v4.1 token and brand component
styles. Standalone vignette styling needs explicit adoption; installing a
package does not change its documentation theme or the user's font settings.

Source archive SHA-256:
`f3c5953d08e9de3ed453e3b840e1698e105a3489eda5331864e66de14aef9abd`
