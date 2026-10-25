# CTTIR v4: artwork-only hexes with an optional name below the hex.
# All illustration, paths, lettering and exports are produced directly in R.
.cttir_source <- base::tryCatch(base::sys.frame(1)$ofile, error=function(e)NULL)
.cttir_rdir <- if(!base::is.null(.cttir_source)) base::dirname(base::normalizePath(.cttir_source)) else "R"
.cttir_root <- base::dirname(.cttir_rdir)
.cttir_fc <- base::file.path(.cttir_root,"fonts","fontconfig-linux.conf")
if(base::Sys.info()[["sysname"]]=="Linux" && base::Sys.getenv("CTTIR_FONTCONFIG","auto")=="auto" &&
   base::file.exists(.cttir_fc)) base::Sys.setenv(FONTCONFIG_FILE=base::normalizePath(.cttir_fc))
base::source(base::file.path(.cttir_rdir,"tokens.R"))
cttir_tokens <- cttir_load_tokens(base::file.path(.cttir_root,"design_tokens.csv"))
for(.f in c("accessibility.R","palette.R","primitives.R","motifs.R"))
  base::source(base::file.path(.cttir_rdir,.f),local=FALSE)
base::rm(.f,.cttir_source,.cttir_rdir,.cttir_root,.cttir_fc)

# Fit exact case and punctuation with device metrics, never stretch text.
# The bundled Linux font profile maps face 2 to JetBrains Mono SemiBold.
cttir_name <- function(name,y=.049,max_width=.90,size=34,colour="#212121",
                       font=cttir_token("type","brand_font")) {
  repeat {
    g <- grid::textGrob(name,gp=grid::gpar(fontfamily=font,fontface=2,fontsize=size))
    if(grid::convertWidth(grid::grobWidth(g),"npc",valueOnly=TRUE)<=max_width || size<=12) break
    size <- size-.25
  }
  grid::grid.text(name,.5,y,gp=grid::gpar(fontfamily=font,fontface=2,fontsize=size,col=colour))
  base::invisible(size)
}

# Both layouts share the identical hex drawing.
cttir_draw <- function(name,family,mode="light",layout=c("hex","lockup"),small=FALSE,
                       font=base::Sys.getenv("CTTIR_BRAND_FONT",cttir_token("type","brand_font")),
                       newpage=TRUE, symbol_only=NULL) {
  layout <- base::match.arg(layout)
  if(!base::is.null(symbol_only)) {layout<-"hex";small<-symbol_only}
  if(newpage) grid::grid.newpage()
  width <- grid::convertWidth(grid::unit(1,"npc"),"inches",valueOnly=TRUE)
  scale <- width/base::as.numeric(cttir_token("layout","hex_width_inches"))
  grid::pushViewport(grid::viewport(gp=grid::gpar(cex=scale,lex=scale)))
  base::on.exit(grid::popViewport(),add=TRUE)
  ratio <- base::sqrt(3)/2
  hex_height <- width/ratio
  total_height <- grid::convertHeight(grid::unit(1,"npc"),"inches",valueOnly=TRUE)
  hex_fraction <- hex_height/total_height
  if(layout=="hex") hex_fraction <- 1
  s <- cttir_style(family,mode)
  # The extra name canvas is below the badge and stays transparent.
  grid::pushViewport(grid::viewport(y=1-hex_fraction/2,height=hex_fraction))
  hex <- function(r,fill,col=NA,lwd=1) grid::grid.polygon(
    .5+c(0,r,r,0,-r,-r),.5+c(r,r/2,-r/2,-r,-r/2,r/2),
    gp=grid::gpar(fill=fill,col=col,lwd=lwd,linejoin="round"))
  # Group-tinted surface, solid group-colour border, no shelf or lettering.
  hex(.480,s$face,s$rim,lwd=5.5)
  size <- base::as.numeric(cttir_token("layout","motif_width"))
  grid::pushViewport(grid::viewport(x=.5,y=.5,width=size,height=size*ratio))
  cttir_motif(name,s,small=small)
  grid::popViewport(2)
  if(layout=="lockup") cttir_name(name,y=(1-hex_fraction)*.45,
    size=base::as.numeric(cttir_token("layout","name_size_points")),colour=s$ink,font=font)
  base::invisible(NULL)
}

# Close the device even when drawing fails.
cttir_device <- function(open_device,draw) {
  open_device();base::on.exit(grDevices::dev.off(),add=TRUE);draw()
  base::invisible(NULL)
}
cttir_dimensions <- function(layout="hex",width=1600L) {
  inches <- base::as.numeric(cttir_token("layout","hex_width_inches"))
  h <- inches/(base::sqrt(3)/2)
  if(layout=="lockup") h <- h+base::as.numeric(cttir_token("layout","lockup_extra_height_inches"))
  list(width=inches,height=h,pixels=c(width,base::round(width*h/inches)))
}
cttir_render <- function(name,family,outdir,width=1600L,
                         font=base::Sys.getenv("CTTIR_BRAND_FONT",cttir_token("type","brand_font"))) {
  base::dir.create(outdir,recursive=TRUE,showWarnings=FALSE)
  for(mode in c("light","dark","mono")) for(layout in c("hex","lockup")) {
    stem <- base::paste0(layout,if(mode=="light")"" else base::paste0("-",mode))
    d <- cttir_dimensions(layout,width)
    draw <- function()cttir_draw(name,family,mode,layout,font=font)
    cttir_device(function()grDevices::svg(base::file.path(outdir,base::paste0(stem,".svg")),
      width=d$width,height=d$height,bg="transparent",family=font),draw)
    cttir_device(function()grDevices::png(base::file.path(outdir,base::paste0(stem,".png")),
      width=d$pixels[1],height=d$pixels[2],res=width/d$width,
      bg="transparent",type="cairo",antialias="gray"),draw)
    cttir_device(function()grDevices::cairo_pdf(base::file.path(outdir,base::paste0(stem,".pdf")),
      width=d$width,height=d$height,bg="transparent",family=font),draw)
  }
  for(px in c(32L,48L,64L,128L,256L)) cttir_device(function()
    grDevices::png(base::file.path(outdir,base::paste0("icon-",px,".png")),
      width=px,height=px,res=px/6,bg="transparent",type="cairo",antialias="gray"),function() {
        grid::grid.newpage();grid::pushViewport(grid::viewport(width=base::sqrt(3)/2,height=1))
        cttir_draw(name,family,mode="dark",small=TRUE,newpage=FALSE);grid::popViewport()
      })
  base::invisible(outdir)
}
cttir_render_package <- function(name,root=".") {
  registry <- utils::read.csv(base::file.path(root,"packages.csv"),stringsAsFactors=FALSE)
  row <- registry[registry$name==name,,drop=FALSE]
  if(base::nrow(row)!=1L)base::stop("Unknown identity: ",name)
  cttir_render(name,row$family,base::file.path(root,"logos",name))
}
