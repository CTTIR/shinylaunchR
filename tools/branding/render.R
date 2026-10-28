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
    "primitives.R", "motifs.R"
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

  for (i in seq_len(nrow(registry))) {
    name <- registry$name[i]
    family <- registry$family[i]
    directory <- file.path(output, if (name == "CTTIR") "CTTIR-brand" else name)
    # Approved masters preserve the supplied v5 name outlines exactly.
    dir.create(directory, recursive = TRUE, showWarnings = FALSE)
    for (layout in c("hex", "lockup")) {
      for (mode in c("light", "dark", "mono")) {
        for (format in c("svg", "png", "pdf")) {
          master <- hexmakR::hex_asset(name, mode, layout, format)
          if (!file.copy(master, file.path(directory, basename(master)),
                         overwrite = TRUE)) stop("Could not copy v5 master.")
        }
      }
    }
    for (size in c(32L, 48L, 64L, 128L, 256L)) {
      master <- hexmakR::hex_asset(name, layout = "icon", format = "png",
                                  size = size)
      if (!file.copy(master, file.path(directory, basename(master)),
                     overwrite = TRUE)) stop("Could not copy v5 icon.")
    }
    for (px in c(16L, 96L, 180L, 192L, 512L)) {
      cttir_device(function() grDevices::png(
        file.path(directory, paste0("icon-", px, ".png")),
        width = px, height = px, res = px / 6, bg = "transparent",
        type = "cairo", antialias = "gray"
      ), function() {
        grid::grid.newpage()
        grid::pushViewport(grid::viewport(width = sqrt(3) / 2, height = 1))
        cttir_draw(name, family, mode = "dark", layout = "hex", small = TRUE, newpage = FALSE)
        grid::popViewport()
      })
    }
    # The complete mark fits within the central maskable safe circle.
    cttir_device(function() grDevices::png(
      file.path(directory, "icon-maskable-512.png"),
      width = 512L, height = 512L, res = 512 / 6, bg = cttir_token("dark", "page"),
      type = "cairo", antialias = "gray"
    ), function() {
      grid::grid.newpage()
      grid::pushViewport(grid::viewport(width = 0.72 * sqrt(3) / 2, height = 0.72))
      cttir_draw(name, family, mode = "dark", layout = "hex", small = TRUE, newpage = FALSE)
      grid::popViewport()
    })
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
source(file.path(dirname(normalizePath(script_files, mustWork = TRUE)), "R", "cttir_hex.R"))
rm(script_files)
run_branding()
