# CTTIR v3: colour roles for original R-drawn scientific identities.
# Topic seeds are the Okabe-Ito colours. Tints/shades add material depth;
# identity is also carried by the custom silhouette and exact package name.
cttir_accents <- c(spectral="#0072B2", spatial="#009E73", omics="#CC79A7",
  clinical="#D55E00", methods="#56B4E9", simulation="#E69F00",
  evidence="#F0E442", platform="#000000", brand="#0072B2")
cttir_family_labels <- c(spectral="SPECTRAL IMAGING", spatial="SPATIAL BIOLOGY",
  omics="MOLECULAR DATA", clinical="CLINICAL SCIENCE", methods="LEARNING & INFERENCE",
  simulation="SYSTEMS & SIMULATION", evidence="EVIDENCE & DISCOVERY",
  platform="RESEARCH INFRASTRUCTURE", brand="SCIENCE, CONNECTED")

cttir_mix <- function(a,b,t) {
  z <- grDevices::col2rgb(a)*t+grDevices::col2rgb(b)*(1-t)
  grDevices::rgb(z[1],z[2],z[3],maxColorValue=255)
}
cttir_alpha <- function(colour, alpha) grDevices::adjustcolor(colour,alpha.f=alpha)
cttir_style <- function(family, mode="primary") {
  base::stopifnot(family %in% base::names(cttir_accents),mode %in% c("primary","light","mono"))
  a <- cttir_accents[[family]]
  # Platform logos use silver as their decorative material, with a black seed.
  material <- if(family=="platform") "#8FAABD" else a
  face <- cttir_mix(material,"#0C1726",.18)
  s <- list(accent=a,material=material,face=face,
    facet=cttir_mix(material,face,.12),facet2=cttir_mix("#FFFFFF",face,.045),
    rim=cttir_mix(material,"#FFFFFF",.65), ink="#F4F8FC",muted="#C6D4E0",
    paper="#F4F8FC",light=cttir_mix(material,"#FFFFFF",.30),
    mid=cttir_mix(material,"#FFFFFF",.78),deep=cttir_mix(material,"#142235",.36),
    edge=cttir_mix(material,"#FFFFFF",.45),shadow="#030A12",mode=mode)
  if(mode=="light") {
    s$face <- cttir_mix(material,"#FFFFFF",.045)
    s$facet <- cttir_mix(material,"#FFFFFF",.09)
    s$facet2 <- "#FFFFFF";s$ink <- "#14283A";s$muted <- "#344F62"
    s$rim <- cttir_mix(material,"#22364A",.45)
    s$edge <- cttir_mix(material,"#14283A",.5)
  }
  if(mode=="mono") {
    s$face <- "#171717";s$facet <- "#303030";s$facet2 <- "#222222"
    s$ink <- "#F4F4F4";s$muted <- "#C6C6C6";s$shadow <- "#050505"
    s$rim <- "#C9C9C9";s$paper <- "#F8F8F8";s$light <- "#DEDEDE"
    s$mid <- "#A7A7A7";s$deep <- "#5C5C5C";s$edge <- "#D5D5D5"
    s$accent <- "#A7A7A7";s$material <- "#A7A7A7"
  }
  # Transform colour roles before vector drawing, never rasterise the artwork.
  vision <- base::getOption("cttir.vision","normal")
  if(vision!="normal") for(n in base::setdiff(base::names(s),"mode"))
    s[[n]] <- cttir_simulate_cvd(s[[n]],vision)
  s
}
