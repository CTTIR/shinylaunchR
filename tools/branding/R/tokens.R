# This versioned table drives both the R artwork and generated documentation CSS.
cttir_load_tokens <- function(path) {
  x <- utils::read.csv(path, stringsAsFactors = FALSE)
  base::stopifnot(!base::anyDuplicated(base::paste(x$group, x$token)))
  out <- x$value
  base::names(out) <- base::paste(x$group, x$token, sep = ".")
  out
}
cttir_token <- function(group, token) {
  key <- base::paste(group, token, sep = ".")
  if (!key %in% base::names(cttir_tokens)) base::stop("Missing token: ", key)
  cttir_tokens[[key]]
}
