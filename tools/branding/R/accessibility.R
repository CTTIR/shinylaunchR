# Physiologically based CVD simulation after Machado et al. (2009), severity 100.
# Matrices transcribed from the colorspacious reference implementation.
# This transforms sRGB colours before drawing; it never edits a raster image.
# Simulations are screening aids, not proof of universal colour discrimination.
cttir_simulate_cvd <- function(colour, type = "deutan") {
  matrices <- list(
    protan = matrix(c(.152286,1.052583,-.204868, .114503,.786281,.099216,
                      -.003882,-.048116,1.051998),3,3,byrow=TRUE),
    deutan = matrix(c(.367322,.860646,-.227968, .280085,.672501,.047413,
                      -.011820,.042940,.968881),3,3,byrow=TRUE),
    tritan = matrix(c(1.255528,-.076749,-.178779, -.078411,.930809,.147602,
                      .004733,.691367,.303900),3,3,byrow=TRUE)
  )
  rgb <- grDevices::col2rgb(colour)/255
  linear <- base::ifelse(rgb <= .04045,rgb/12.92,((rgb+.055)/1.055)^2.4)
  if(type=="gray") {
    luminance <- c(.2126,.7152,.0722) %*% linear
    result <- matrix(base::rep(luminance,each=3),nrow=3)
  } else {
    base::stopifnot(type %in% base::names(matrices))
    result <- matrices[[type]] %*% linear
  }
  result[] <- base::pmin(1,base::pmax(0,result))
  srgb <- base::ifelse(result<=.0031308,12.92*result,1.055*result^(1/2.4)-.055)
  grDevices::rgb(srgb[1,],srgb[2,],srgb[3,])
}
