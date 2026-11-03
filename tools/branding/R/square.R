# Square v5 logos for CTTIR software that is not an R package (Zotero
# plugins, web apps). R packages keep the hex; these use a rounded square in
# the reserved apps family (wine, topic,apps), with the same motifs,
# primitives and shading. "hex" is the artwork-only square and "lockup" the
# square with the name inside, so existing asset maps keep working.
#
# The name uses the installed JetBrains Mono ExtraBold, the closest cut to
# the supplied v5 hex names, so render with the system fontconfig
# (CTTIR_FONTCONFIG=off) and JetBrains Mono installed.

cttir_square_font <- "JetBrains Mono ExtraBold"

cttir_square_tile <- function(s, opaque = FALSE, inset = .035, r = .06) {
  if (opaque) grid::grid.rect(gp = grid::gpar(fill = s$face, col = NA))
  grid::grid.roundrect(.5, .5, 1 - 2 * inset, 1 - 2 * inset, r = grid::unit(r, "npc"),
    gp = grid::gpar(fill = s$face, col = s$rim, lwd = 5.5))
}

# Fit the exact name with device metrics, never stretching it.
cttir_square_name <- function(name, y, max_width, size, colour) {
  repeat {
    g <- grid::textGrob(name, gp = grid::gpar(fontfamily = cttir_square_font, fontsize = size))
    if (grid::convertWidth(grid::grobWidth(g), "npc", valueOnly = TRUE) <= max_width ||
        size <= 12) break
    size <- size - .25
  }
  grid::grid.text(name, .5, y, gp = grid::gpar(fontfamily = cttir_square_font,
                                               fontsize = size, col = colour))
  base::invisible(size)
}

cttir_square_draw <- function(name, family, mode = "light", layout = c("hex", "lockup"),
                              small = FALSE, opaque = FALSE, newpage = TRUE) {
  layout <- base::match.arg(layout)
  if (newpage) grid::grid.newpage()
  width <- grid::convertWidth(grid::unit(1, "npc"), "inches", valueOnly = TRUE)
  scale <- width / base::as.numeric(cttir_token("layout", "hex_width_inches"))
  grid::pushViewport(grid::viewport(gp = grid::gpar(cex = scale, lex = scale)))
  base::on.exit(grid::popViewport(), add = TRUE)
  s <- cttir_style(family, mode)
  cttir_square_tile(s, opaque)
  if (layout == "lockup") {
    grid::pushViewport(grid::viewport(x = .5, y = .585, width = .66, height = .66))
    cttir_motif(name, s, small = small); grid::popViewport()
    cttir_square_name(name, y = .135, max_width = .80, colour = s$ink,
      size = base::as.numeric(cttir_token("layout", "name_size_points")))
  } else {
    grid::pushViewport(grid::viewport(width = .80, height = .80))
    cttir_motif(name, s, small = small); grid::popViewport()
  }
  base::invisible(NULL)
}

cttir_square_installed <- function() {
  fonts <- systemfonts::system_fonts()
  base::any(fonts$family == "JetBrains Mono" & fonts$style == "ExtraBold")
}
