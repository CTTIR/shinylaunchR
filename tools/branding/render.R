# Reproduce the registered Material Atlas assets without changing runtime code.
args <- commandArgs(trailingOnly = FALSE)
script <- sub("^--file=", "", args[grepl("^--file=", args)])
if (length(script) != 1L) stop("Run this file with Rscript.")
branding <- dirname(normalizePath(script))
repository <- normalizePath(file.path(branding, "..", ".."))
params <- commandArgs(trailingOnly = TRUE)
if (length(params) != 1L) stop("Supply an output directory or --apply.")
apply <- identical(params, "--apply")
output <- if (apply) tempfile("branding-") else params
source(file.path(branding, "R", "cttir_hex.R"))
registry <- utils::read.csv(file.path(branding, "packages.csv"), stringsAsFactors = FALSE)
if (!capabilities("cairo")) stop("Cairo graphics are required.")
write_ico <- function(paths, destination) {
  images <- lapply(paths, function(path) readBin(path, "raw", n = file.info(path)$size))
  con <- file(destination, "wb")
  on.exit(close(con), add = TRUE)
  writeBin(as.integer(c(0, 1, length(images))), con, size = 2L, endian = "little")
  offset <- 6L + 16L * length(images)
  for (i in seq_along(images)) {
    size <- c(16L, 32L, 48L, 256L)[i]
    byte_size <- if (size == 256L) 0L else size
    writeBin(as.raw(c(byte_size, byte_size, 0, 0)), con)
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
  writeBin(as.integer(8L + sum(lengths(images) + 8L)), con,
           size = 4L, endian = "big")
  for (i in seq_along(images)) {
    writeBin(charToRaw(types[i]), con)
    writeBin(as.integer(length(images[[i]]) + 8L), con,
             size = 4L, endian = "big")
    writeBin(images[[i]], con)
  }
}
for (i in seq_len(nrow(registry))) {
  name <- registry$name[i]
  family <- registry$family[i]
  destination <- file.path(output, name)
  cttir_render(name, family, destination)
  cttir_device(function() grDevices::png(
    file.path(destination, "logo-symbol.png"),
    width = 1600L, height = 1848L, res = 1600 / 6, bg = "transparent",
    type = "cairo", antialias = "gray"
  ), function() cttir_draw(name, family, symbol_only = TRUE))
  # Keep the complete unnamed mark inside the PWA maskable safe circle.
  cttir_device(function() grDevices::png(
    file.path(destination, "icon-maskable-512.png"),
    width = 512L, height = 512L, res = 512 / 6, bg = "#0f172a",
    type = "cairo", antialias = "gray"
  ), function() {
    grid::grid.newpage()
    grid::pushViewport(grid::viewport(width = 0.72 * sqrt(3) / 2, height = 0.72))
    cttir_draw(name, family, symbol_only = TRUE, newpage = FALSE)
    grid::popViewport()
  })
  for (px in c(16L, 96L, 180L, 192L, 512L)) {
    cttir_device(function() grDevices::png(
      file.path(destination, paste0("icon-", px, ".png")),
      width = px, height = px, res = px / 6, bg = "transparent",
      type = "cairo", antialias = "gray"
    ), function() {
      grid::grid.newpage()
      grid::pushViewport(grid::viewport(width = sqrt(3) / 2, height = 1))
      cttir_draw(name, family, symbol_only = TRUE, newpage = FALSE)
      grid::popViewport()
    })
  }
  write_ico(file.path(destination, paste0("icon-", c(16L, 32L, 48L, 256L), ".png")),
            file.path(destination, "favicon.ico"))
  write_icns(destination)
}
if (apply) {
  map <- utils::read.csv(file.path(branding, "assets.csv"), stringsAsFactors = FALSE)
  for (i in seq_len(nrow(map))) {
    relative <- map$destination[i]
    if (grepl("(^/|^[A-Za-z]:|(^|[/\\\\])\\.\\.([/\\\\]|$))", relative)) {
      stop("Asset destination must remain inside the repository.")
    }
    source <- file.path(output, map$identity[i], map$rendered[i])
    target <- file.path(repository, relative)
    dir.create(dirname(target), recursive = TRUE, showWarnings = FALSE)
    if (!file.copy(source, target, overwrite = TRUE)) stop("Could not replace ", relative)
  }
  unlink(output, recursive = TRUE)
}
message("Rendered ", nrow(registry), " identities", if (apply) " and updated registered assets." else paste0(" into ", output))
