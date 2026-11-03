# Reproduce registered CTTIR v5 artwork and application icons.
run_branding <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  script <- sub("^--file=", "", args[grepl("^--file=", args)])
  if (length(script) != 1L) stop("Run this file with Rscript.")
  branding <- dirname(normalizePath(script, winslash = "/", mustWork = TRUE))
  repository <- normalizePath(file.path(branding, "..", ".."),
                              winslash = "/", mustWork = TRUE)
  params <- commandArgs(trailingOnly = TRUE)
  if (length(params) != 1L || is.na(params) || !nzchar(params)) {
    stop("Supply an output directory or --apply.")
  }
  apply <- identical(params, "--apply")
  if (!requireNamespace("hexmakR", quietly = TRUE) ||
      utils::packageVersion("hexmakR") < "0.2.0") {
    stop("Install hexmakR >= 0.2.0 to use the approved v5 artwork library.")
  }

  required <- c("packages.csv", "design_tokens.csv", file.path("R", c(
    "cttir_hex.R", "tokens.R", "accessibility.R", "palette.R",
    "primitives.R", "motifs.R", "square.R"
  )))
  if (!all(file.exists(file.path(branding, required)))) {
    stop("The branding source bundle is incomplete.")
  }
  registry <- utils::read.csv(file.path(branding, "packages.csv"),
                              stringsAsFactors = FALSE)
  if (!all(c("name", "family") %in% names(registry)) || nrow(registry) < 1L) {
    stop("packages.csv must contain name and family rows.")
  }
  if (anyNA(registry$name) || anyNA(registry$family) ||
      any(!grepl("^[A-Za-z][A-Za-z0-9_.-]*$", registry$name)) ||
      anyDuplicated(registry$name)) {
    stop("Identity names must be unique and contain no path components.")
  }
  if (any(!registry$family %in% names(cttir_accents))) {
    stop("packages.csv contains an unknown topic family.")
  }
  if (!capabilities("cairo")) stop("Cairo graphics are required.")

  stems <- c("hex", "hex-dark", "hex-mono", "lockup", "lockup-dark", "lockup-mono")
  valid_files <- c(as.vector(outer(stems, c("svg", "png", "pdf"), paste, sep = ".")),
    paste0("icon-", c(16L, 32L, 48L, 64L, 96L, 128L, 180L, 192L, 256L, 512L), ".png"),
    "icon-maskable-512.png", "favicon.ico", "icon.icns")

  # Resolve existing ancestors so a symlink cannot redirect writes outside this repository.
  destination_path <- function(relative) {
    if (length(relative) != 1L || is.na(relative) || !nzchar(relative) ||
        grepl("^[A-Za-z]:|^/|/$|\\\\", relative) ||
        any(strsplit(relative, "/", fixed = TRUE)[[1]] %in% c("", ".", ".."))) {
      stop("Asset destinations must be ordinary repository-relative paths.")
    }
    target <- file.path(repository, relative)
    ancestor <- target
    repeat {
      link <- Sys.readlink(ancestor)
      linked <- !is.na(link) && nzchar(link)
      exists <- file.exists(ancestor) || dir.exists(ancestor)
      if (linked && !exists) stop("Asset destination follows a dangling symlink: ", relative)
      if (exists) break
      parent <- dirname(ancestor)
      if (identical(parent, ancestor)) stop("Cannot resolve asset destination: ", relative)
      ancestor <- parent
    }
    resolved <- normalizePath(ancestor, winslash = "/", mustWork = TRUE)
    if (!identical(resolved, repository) &&
        !startsWith(resolved, paste0(repository, "/"))) {
      stop("Asset destination escapes the repository through a symlink: ", relative)
    }
    if (dir.exists(target)) stop("Asset destination is a directory: ", relative)
    target
  }

  map <- NULL
  if (apply) {
    map <- utils::read.csv(file.path(branding, "assets.csv"), stringsAsFactors = FALSE)
    columns <- c("identity", "rendered", "destination")
    if (!all(columns %in% names(map)) || nrow(map) < 1L || anyNA(map[columns]) ||
        any(!map$identity %in% registry$name) || any(!map$rendered %in% valid_files) ||
        anyDuplicated(map$destination)) {
      stop("assets.csv must map known identities and rendered files to unique destinations.")
    }
    invisible(lapply(map$destination, destination_path))
  }

  output <- if (apply) tempfile("branding-") else params
  if (apply) on.exit(unlink(output, recursive = TRUE), add = TRUE)

  write_ico <- function(directory) {
    sizes <- c(16L, 32L, 48L, 256L)
    images <- lapply(sizes, function(size) {
      path <- file.path(directory, paste0("icon-", size, ".png"))
      readBin(path, "raw", n = file.info(path)$size)
    })
    con <- file(file.path(directory, "favicon.ico"), "wb")
    on.exit(close(con), add = TRUE)
    writeBin(as.integer(c(0, 1, length(images))), con, size = 2L, endian = "little")
    offset <- 6L + 16L * length(images)
    for (i in seq_along(images)) {
      size <- if (sizes[i] == 256L) 0L else sizes[i]
      writeBin(as.raw(c(size, size, 0, 0)), con)
      writeBin(as.integer(c(1, 32)), con, size = 2L, endian = "little")
      writeBin(as.integer(c(length(images[[i]]), offset)), con, size = 4L, endian = "little")
      offset <- offset + length(images[[i]])
    }
    for (raw in images) writeBin(raw, con)
  }

  write_icns <- function(directory) {
    sizes <- c(128L, 256L, 512L)
    types <- c("ic07", "ic08", "ic09")
    images <- lapply(sizes, function(size) {
      path <- file.path(directory, paste0("icon-", size, ".png"))
      readBin(path, "raw", n = file.info(path)$size)
    })
    con <- file(file.path(directory, "icon.icns"), "wb")
    on.exit(close(con), add = TRUE)
    writeBin(charToRaw("icns"), con)
    writeBin(as.integer(8L + sum(lengths(images) + 8L)), con, size = 4L, endian = "big")
    for (i in seq_along(images)) {
      writeBin(charToRaw(types[i]), con)
      writeBin(as.integer(length(images[[i]]) + 8L), con, size = 4L, endian = "big")
      writeBin(images[[i]], con)
    }
  }

  # Software that is not an R package uses the square v5 logo in the apps
  # family, drawn here; hex = artwork-only square, lockup = named square.
  square_families <- "apps"
  if (any(registry$family %in% square_families) && !cttir_square_installed()) {
    stop("Install JetBrains Mono ExtraBold to render square logos.")
  }
  draw_square <- function(name, family, mode, layout, directory) {
    stem <- paste0(layout, if (mode == "light") "" else paste0("-", mode))
    draw <- function() cttir_square_draw(name, family, mode, layout)
    cttir_device(function() grDevices::svg(file.path(directory, paste0(stem, ".svg")),
      width = 6, height = 6, bg = "transparent"), draw)
    cttir_device(function() grDevices::png(file.path(directory, paste0(stem, ".png")),
      width = 1600L, height = 1600L, res = 1600 / 6, bg = "transparent",
      type = "cairo", antialias = "gray"), draw)
    cttir_device(function() grDevices::cairo_pdf(file.path(directory, paste0(stem, ".pdf")),
      width = 6, height = 6, bg = "transparent"), draw)
  }

  # The approved master is recoloured instead of copied when the identity's
  # family differs from the family hexmakR drew it in (the reserved core
  # palette, or a package moved to another family) and for suite packages
  # (kind "Suite"), which keep their family colours with the CTTIR gold rim.
  # The bundled renderer draws the master's element sequence, so its colours
  # replace the master's one by one and the supplied name outlines stay
  # intact.
  library_registry <- utils::read.csv(
    system.file("cttir", "packages.csv", package = "hexmakR", mustWork = TRUE),
    stringsAsFactors = FALSE)
  master_family <- stats::setNames(library_registry$family, library_registry$name)
  colour_attr <- "(fill|stroke)=\"rgb\\([^)]*\\)\""
  colour_attrs <- function(x) regmatches(x, gregexpr(colour_attr, x))[[1]]
  draw_svg <- function(name, family, mode, layout, suite) {
    old <- options(cttir.suite = suite)
    on.exit(options(old), add = TRUE)
    file <- tempfile(fileext = ".svg")
    on.exit(unlink(file), add = TRUE)
    d <- cttir_dimensions(layout)
    cttir_device(function() grDevices::svg(file, width = d$width, height = d$height,
                                           bg = "transparent"),
                 function() cttir_draw(name, family, mode, layout))
    readChar(file, file.size(file), useBytes = TRUE)
  }
  recolour_master <- function(name, family, mode, layout, directory, suite) {
    base <- master_family[[name]]
    path <- hexmakR::hex_asset(name, mode, layout, "svg")
    master <- readChar(path, file.size(path), useBytes = TRUE)
    if (!identical(colour_attrs(master),
                   colour_attrs(draw_svg(name, base, mode, layout, FALSE)))) {
      stop("The ", name, " ", mode, " ", layout,
           " master no longer matches the bundled renderer.")
    }
    recoloured <- colour_attrs(draw_svg(name, family, mode, layout, suite))
    if (length(recoloured) != length(colour_attrs(master))) {
      stop("The recolouring changed the ", name, " drawing structure.")
    }
    regmatches(master, gregexpr(colour_attr, master)) <- list(recoloured)
    stem <- paste0(layout, if (mode == "light") "" else paste0("-", mode))
    writeChar(master, file.path(directory, paste0(stem, ".svg")), eos = NULL,
              useBytes = TRUE)
    # PNG and PDF follow hexmakR: drawn from the SVG at the master pixel size.
    stretched <- sub("<svg ", "<svg preserveAspectRatio=\"none\" ", master, fixed = TRUE)
    rsvg::rsvg_png(charToRaw(stretched), file.path(directory, paste0(stem, ".png")),
                   width = 1600L, height = 1848L)
    rsvg::rsvg_pdf(charToRaw(master), file.path(directory, paste0(stem, ".pdf")))
  }

  for (i in seq_len(nrow(registry))) {
    name <- registry$name[i]
    family <- registry$family[i]
    suite <- "kind" %in% names(registry) && identical(registry$kind[i], "Suite")
    square <- family %in% square_families
    if (!square && !name %in% names(master_family)) {
      stop(name, " has no approved master in hexmakR.")
    }
    recolour <- !square && (suite || !identical(master_family[[name]], family))
    if (recolour && !requireNamespace("rsvg", quietly = TRUE)) {
      stop("Install rsvg to recolour the ", name, " master.")
    }
    directory <- file.path(output, if (name == "CTTIR") "CTTIR-brand" else name)
    # Approved masters preserve the supplied v5 name outlines exactly.
    dir.create(directory, recursive = TRUE, showWarnings = FALSE)
    for (layout in c("hex", "lockup")) {
      for (mode in c("light", "dark", "mono")) {
        # Greyscale is shared by every identity and stays as supplied.
        if (square) {
          draw_square(name, family, mode, layout, directory)
          next
        }
        if (recolour && mode != "mono") {
          recolour_master(name, family, mode, layout, directory, suite)
          next
        }
        for (format in c("svg", "png", "pdf")) {
          master <- hexmakR::hex_asset(name, mode, layout, format)
          if (!file.copy(master, file.path(directory, basename(master)),
                         overwrite = TRUE)) stop("Could not copy v5 master.")
        }
      }
    }
    # Icons carry no name, so a recoloured identity draws every size.
    old_suite <- options(cttir.suite = suite)
    drawn <- c(16L, 96L, 180L, 192L, 512L)
    if (recolour || square) {
      drawn <- sort(c(drawn, 32L, 48L, 64L, 128L, 256L))
    } else for (size in c(32L, 48L, 64L, 128L, 256L)) {
      master <- hexmakR::hex_asset(name, layout = "icon", format = "png",
                                  size = size)
      if (!file.copy(master, file.path(directory, basename(master)),
                     overwrite = TRUE)) stop("Could not copy v5 icon.")
    }
    for (px in drawn) {
      cttir_device(function() grDevices::png(
        file.path(directory, paste0("icon-", px, ".png")),
        width = px, height = px, res = px / 6, bg = "transparent",
        type = "cairo", antialias = "gray"
      ), function() {
        grid::grid.newpage()
        if (square) {
          cttir_square_draw(name, family, "dark", "hex", small = px <= 64, newpage = FALSE)
        } else {
          grid::pushViewport(grid::viewport(width = sqrt(3) / 2, height = 1))
          cttir_draw(name, family, mode = "dark", layout = "hex", small = TRUE, newpage = FALSE)
          grid::popViewport()
        }
      })
    }
    # The complete mark fits within the central maskable safe circle.
    cttir_device(function() grDevices::png(
      file.path(directory, "icon-maskable-512.png"),
      width = 512L, height = 512L, res = 512 / 6, bg = cttir_token("dark", "page"),
      type = "cairo", antialias = "gray"
    ), function() {
      grid::grid.newpage()
      grid::pushViewport(grid::viewport(width = 0.72 * if (square) 1 else sqrt(3) / 2,
                                        height = 0.72))
      if (square) {
        cttir_square_draw(name, family, "dark", "hex", small = TRUE, newpage = FALSE)
      } else {
        cttir_draw(name, family, mode = "dark", layout = "hex", small = TRUE, newpage = FALSE)
      }
      grid::popViewport()
    })
    options(old_suite)
    write_ico(directory)
    write_icns(directory)
  }

  if (apply) {
    asset_dirs <- ifelse(map$identity == "CTTIR", "CTTIR-brand", map$identity)
    sources <- file.path(output, asset_dirs, map$rendered)
    if (!all(file.exists(sources))) stop("A registered rendered file is missing.")
    for (i in seq_len(nrow(map))) {
      target <- destination_path(map$destination[i])
      dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
      target <- destination_path(map$destination[i])
      if (!file.copy(sources[i], target, overwrite = TRUE)) {
        stop("Could not replace ", map$destination[i])
      }
    }
  }
  message("Rendered ", nrow(registry), " identities",
          if (apply) " and updated registered assets." else paste0(" into ", output))
}
# The supplied renderer discovers its relative sources from a top-level source call.
script_files <- sub("^--file=", "", commandArgs(trailingOnly = FALSE)[
  grepl("^--file=", commandArgs(trailingOnly = FALSE))
])
if (length(script_files) != 1L) stop("Run this file with Rscript.")
# Square logos name the software in the installed JetBrains Mono ExtraBold,
# which the bundled font profile would hide; hex masters are copied or
# recoloured, so their supplied name outlines do not depend on it.
Sys.setenv(CTTIR_FONTCONFIG = "off")
source(file.path(dirname(normalizePath(script_files, mustWork = TRUE)), "R", "cttir_hex.R"))
source(file.path(dirname(normalizePath(script_files, mustWork = TRUE)), "R", "square.R"))
rm(script_files)
run_branding()
