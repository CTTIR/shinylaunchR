# Colour supports identity; distinct scientific silhouettes remain the main cue.
# UI link colours stay separate from topic colours.
cttir_accents <- cttir_tokens[base::grepl("^topic[.]", base::names(cttir_tokens))]
base::names(cttir_accents) <- base::sub("^topic[.]", "", base::names(cttir_accents))
cttir_family_labels <- c(spectral="Spectral imaging", spatial="Spatial biology",
  omics="Molecular data", clinical="Clinical science", methods="Statistical inference",
  simulation="Systems & simulation", evidence="Evidence & discovery",
  platform="Research infrastructure", brand="Science, connected",
  core="CTTIR core", apps="Apps & plugins", consensus="Consensus & ideation",
  embedding="Dimension reduction & visualisation")
cttir_mix <- function(a,b,t) {
  z <- grDevices::col2rgb(a)*t + grDevices::col2rgb(b)*(1-t)
  grDevices::rgb(z[1],z[2],z[3],maxColorValue=255)
}
cttir_alpha <- function(colour, alpha) grDevices::adjustcolor(colour,alpha.f=alpha)
cttir_style <- function(family, mode="light") {
  if (mode=="primary") mode <- "dark"
  if (family=="core") return(cttir_core_style(mode))
  base::stopifnot(family %in% base::names(cttir_accents), mode %in% c("light","dark","mono"))
  a <- cttir_accents[[family]]
  material <- if(family=="platform") "#8FAABD" else a
  theme <- if(mode=="dark") "dark" else "light"
  s <- list(accent=a, material=material, face=cttir_token(theme,"page"),
    facet=cttir_token(theme,"page"), facet2=cttir_token(theme,"page"),
    rim=cttir_mix(material,"#FFFFFF",.65), ink=cttir_token(theme,"heading"),
    muted=cttir_token(theme,"text"), paper="#F4F8FC",
    light=cttir_mix(material,"#FFFFFF",.30), mid=cttir_mix(material,"#FFFFFF",.78),
    deep=cttir_mix(material,"#142235",.36), edge=cttir_mix(material,"#FFFFFF",.45),
    shadow="#030A12", mode=mode)
  if(mode=="light") {
    s$rim <- cttir_mix(material,"#22364A",.45)
    s$edge <- cttir_mix(material,"#14283A",.5)
  }
  if(mode=="mono") {
    s$face <- "#FAFAFA"; s$facet <- s$face; s$facet2 <- s$face
    s$ink <- "#212121"; s$muted <- "#424242"; s$shadow <- "#050505"
    s$rim <- "#5C5C5C"; s$paper <- "#F8F8F8"; s$light <- "#DEDEDE"
    s$mid <- "#A7A7A7"; s$deep <- "#5C5C5C"; s$edge <- "#444444"
    s$accent <- "#A7A7A7"; s$material <- "#A7A7A7"
    s$mode <- "light"
  }
  # Group-synchronised tile and opaque border; grayscale stays achromatic.
  if(mode!="mono") {
    s$face <- cttir_mix(a,cttir_token(theme,"page"),if(mode=="light") .14 else .24)
    s$facet <- s$face; s$facet2 <- s$face
    s$rim <- a
  }
  # Suite packages (cttir.suite option) keep their family colours with the
  # CTTIR gold rim shared with cttiR and the institution logo.
  if(mode!="mono" && base::isTRUE(base::getOption("cttir.suite",FALSE)))
    s$rim <- if(mode=="light") cttir_token("core","accent_light") else cttir_accents[["core"]]
  vision <- base::getOption("cttir.vision","normal")
  if(vision!="normal") for(n in base::setdiff(base::names(s),"mode"))
    s[[n]] <- cttir_simulate_cvd(s[[n]],vision)
  s
}
# CTTIR core, reserved for the institution logo and cttiR: the cttiR
# (platform) scale with a gold accent on the rim. Light surfaces use the
# deeper gold so it keeps 3:1 against white; greyscale stays shared.
cttir_core_style <- function(mode="light") {
  s <- cttir_style("platform", mode)
  if (mode!="mono") {
    g <- if (mode=="light") cttir_token("core","accent_light") else cttir_accents[["core"]]
    vision <- base::getOption("cttir.vision","normal")
    if (vision!="normal") g <- cttir_simulate_cvd(g,vision)
    s$accent <- g; s$rim <- g
  }
  s
}
