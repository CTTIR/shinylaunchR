/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
/** Constant programs: all variable values arrive through the child environment. */
export const LAUNCH_SCRIPT = `
port <- as.integer(Sys.getenv("SLR_PORT"))
options(shiny.port=port, shiny.host="127.0.0.1", shiny.launch.browser=FALSE)
if (Sys.getenv("SLR_KIND") == "source") {
  shiny::runApp(Sys.getenv("SLR_APP_DIR"))
} else {
  pkg <- Sys.getenv("SLR_PACKAGE")
  fun <- Sys.getenv("SLR_FUNCTION")
  if (!requireNamespace(pkg, quietly=TRUE)) stop("Package or dependency cannot load; reinstall the app.")
  launcher <- getExportedValue(pkg, fun)
  result <- launcher()
  if (inherits(result, "shiny.appobj")) shiny::runApp(result)
}
`;
export const INSTALL_SCRIPT = `
lib <- Sys.getenv("SLR_LIBRARY")
dir.create(lib, showWarnings=FALSE, recursive=TRUE)
.libPaths(c(lib, .libPaths()))
repos <- Sys.getenv("SLR_REPOS")
options(repos=c(CRAN=repos))
pkg <- Sys.getenv("SLR_PACKAGE")
kind <- Sys.getenv("SLR_KIND")
repo <- Sys.getenv("SLR_REPO")
pkgs <- strsplit(Sys.getenv("SLR_PACKAGES"), ",", fixed=TRUE)[[1]]
pkgs <- pkgs[nzchar(pkgs)]
install_cran <- function(p) {
  withCallingHandlers(utils::install.packages(p, lib=lib, repos=repos, dependencies=NA),
    warning=function(w) {
      if (grepl("non-zero exit status|not available|failed|cannot", conditionMessage(w), ignore.case=TRUE)) stop(conditionMessage(w))
    })
}
helper <- if (Sys.getenv("SLR_PAK") == "true") "pak" else "remotes"
if (helper == "pak" || kind == "github") {
  if (!requireNamespace(helper, quietly=TRUE)) install_cran(helper)
}
if (kind == "source") {
  missing <- pkgs[!vapply(pkgs,function(p) dir.exists(file.path(lib,p)),logical(1))]
  if (length(missing)) {
    if (helper == "pak") pak::pkg_install(missing,lib=lib,dependencies=NA,upgrade=FALSE,ask=FALSE)
    else install_cran(missing)
  }
} else if (helper == "pak") {
  pak::pkg_install(if(kind == "github") repo else pkg,lib=lib,dependencies=NA,upgrade=FALSE,ask=FALSE)
} else if (kind == "github") {
  remotes::install_github(repo,lib=lib,dependencies=NA,upgrade="never")
} else install_cran(pkg)
if (kind == "source") {
  hints <- strsplit(Sys.getenv("SLR_ADVISORY"), ",", fixed=TRUE)[[1]]
  hints <- hints[nzchar(hints)]
  for (p in hints) if (!requireNamespace(p,quietly=TRUE)) {
    tryCatch({
      if (helper == "pak") pak::pkg_install(p,lib=lib,dependencies=NA,upgrade=FALSE,ask=FALSE)
      else install_cran(p)
    },error=function(e) cat("Optional scan suggestion not installed:",p,"\\n"))
  }
}
targets <- if(kind == "source") pkgs else pkg
for (p in targets) {
  location <- find.package(p,lib.loc=lib,quiet=TRUE)
  if (!length(location) || !requireNamespace(p,lib.loc=lib,quietly=TRUE)) stop(paste("Managed installation cannot load:",p))
  if (normalizePath(dirname(location)) != normalizePath(lib)) stop("Package resolved outside managed library")
  cat("INSTALLED:",p,":",as.character(utils::packageVersion(p,lib.loc=lib)),"\\n",sep="")
}
cat("INSTALL_OK\\n")
`;
export const ICON_SCRIPT = `
pkg <- Sys.getenv("SLR_PACKAGE")
cands <- c(system.file("help","figures","logo.png",package=pkg),
 system.file("help","figures","logo.svg",package=pkg),
 system.file("figures","logo.png",package=pkg),system.file("figures","logo.svg",package=pkg),
 system.file("www","logo.png",package=pkg))
hit <- cands[nzchar(cands) & file.exists(cands)]
if(length(hit)) cat(hit[1],"\\n",sep="")
`;
export const RUNTIME_SCRIPT =
  'cat("SLR_RUNTIME:",as.character(getRversion()),":",R.version$arch,"\\n",sep="")';
