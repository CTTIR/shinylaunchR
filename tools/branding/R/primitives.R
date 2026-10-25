# Shared geometric vocabulary. All coordinates use a square local viewport.
# Cast shadows use offset vector geometry, so SVG/PDF remain entirely vector.
cttir_primitives <- function(s, small=FALSE) {
  P <- function(x,y,fill=s$mid,col=NA,lwd=1.5,shadow=FALSE) {
    if(s$mode=="light" && base::is.na(col) && fill %in% c(s$paper,s$light)) {col<-s$edge;lwd<-.8}
    if(shadow) grid::grid.polygon(x+.012,y-.021,
      gp=grid::gpar(fill=cttir_alpha(s$shadow,.25),col=NA))
    grid::grid.polygon(x,y,gp=grid::gpar(fill=fill,col=col,lwd=lwd,linejoin="round"))
  }
  L <- function(x,y,col=s$paper,lwd=3,lty=1,arrow=FALSE) {
    # White or pastel free-standing strokes need dark ink on a pale badge.
    if(s$mode=="light" && col %in% c(s$paper,s$light)) col<-s$edge
    grid::grid.lines(x,y,arrow=if(arrow)grid::arrow(length=grid::unit(.035,"npc"),type="closed") else NULL,
      gp=grid::gpar(col=col,fill=col,lwd=lwd,lty=lty,lineend="round",linejoin="round"))
  }
  C <- function(x,y,r=.05,fill=s$paper,col=NA,lwd=2,shadow=FALSE) {
    if(s$mode=="light" && base::is.na(col) && fill %in% c(s$paper,s$light)) {col<-s$edge;lwd<-.8}
    if(shadow) grid::grid.circle(x+.010,y-.016,r,
      gp=grid::gpar(fill=cttir_alpha(s$shadow,.25),col=NA))
    grid::grid.circle(x,y,r,gp=grid::gpar(fill=fill,col=col,lwd=lwd))
  }
  B <- function(x,y,w,h,fill=s$paper,r=.025,col=NA,lwd=1.5,shadow=FALSE) {
    if(s$mode=="light" && base::is.na(col) && fill %in% c(s$paper,s$light)) {col<-s$edge;lwd<-.8}
    if(shadow) grid::grid.roundrect(x+.012,y-.021,w,h,r=grid::unit(r,"npc"),
      gp=grid::gpar(fill=cttir_alpha(s$shadow,.28),col=NA))
    grid::grid.roundrect(x,y,w,h,r=grid::unit(r,"npc"),
      gp=grid::gpar(fill=fill,col=col,lwd=lwd))
  }
  A <- function(x,y,r,start=0,end=360,col=s$paper,lwd=3) {
    t <- base::seq(start,end,length.out=80)*pi/180
    L(x+r*base::cos(t),y+r*base::sin(t),col,lwd)
  }
  # Cubic Bezier curves, sampled as vector paths with deterministic geometry.
  Q <- function(x,y,col=s$paper,lwd=3,fill=NULL) {
    t <- base::seq(0,1,length.out=70)
    xx <- (1-t)^3*x[1]+3*(1-t)^2*t*x[2]+3*(1-t)*t^2*x[3]+t^3*x[4]
    yy <- (1-t)^3*y[1]+3*(1-t)^2*t*y[2]+3*(1-t)*t^2*y[3]+t^3*y[4]
    if(base::is.null(fill)) L(xx,yy,col,lwd) else P(xx,yy,fill,col,lwd)
  }
  H <- function(x,y,r=.16,fill=s$mid,shadow=FALSE,col=NA) {
    t <- (90+0:5*60)*pi/180
    P(x+r*base::cos(t),y+r*base::sin(t),fill,col,shadow=shadow)
  }
  # Parallel-sided extruded rhombus, a shared spectral/material plane.
  slab <- function(x=.5,y=.5,w=.65,h=.31,d=.055,fill=s$mid,grid=FALSE) {
    P(x+c(-w/2,0,0,-w/2),y+c(0,-h/2,-h/2-d,-d),s$deep)
    P(x+c(0,w/2,w/2,0),y+c(-h/2,0,-d,-h/2-d),cttir_mix(fill,s$deep,.5))
    P(x+c(-w/2,0,w/2,0),y+c(0,h/2,0,-h/2),fill,shadow=FALSE)
    if(grid && !small) for(t in c(.25,.5,.75)) {
      L(x+c(-w/2+t*w/2,t*w/2),y+c(t*h/2,-h/2+t*h/2),cttir_alpha(s$paper,.4),1)
      L(x+c(-t*w/2,w/2-t*w/2),y+c(-h/2+t*h/2,t*h/2),cttir_alpha(s$paper,.4),1)
    }
    L(x+c(-w/2,0,w/2),y+c(0,h/2,0),cttir_alpha(s$paper,.62),1.5)
  }
  cell <- function(x,y,r=.10,fill=s$mid,phase=0,nucleus=TRUE) {
    t <- base::seq(0,2*pi,length.out=90)
    rr <- r*(1+.055*base::sin(5*t+phase)+.035*base::cos(3*t-phase))
    P(x+rr*base::cos(t),y+rr*base::sin(t),fill,shadow=TRUE)
    if(!small) A(x,y,r*.83,25,145,cttir_alpha(s$paper,.6),2)
    if(nucleus) {C(x-r*.08,y+r*.04,r*.32,s$deep);C(x-r*.11,y+r*.11,r*.13,s$paper)}
  }
  node <- function(x,y,r=.04,fill=s$mid) {C(x,y,r,fill,shadow=TRUE);if(!small)C(x-r*.18,y+r*.2,r*.26,s$paper)}
  capsule <- function(x,y,w=.22,h=.09,fill=s$mid) B(x,y,w,h,fill,r=h/2,shadow=TRUE)
  # A faceted circular disc, useful for lenses, wells and embedded controls.
  disc <- function(x,y,r=.17,fill=s$mid) {
    C(x,y,r,s$deep,shadow=TRUE);C(x,y+.012,r*.91,fill)
    A(x,y+.012,r*.78,28,150,s$light,3)
  }
  check <- function(x,y,size=.12,col=s$deep,lwd=6) L(x+c(-.5,-.12,.65)*size,y+c(0,-.4,.5)*size,col,lwd)
  plus <- function(x,y,size=.1,col=s$paper,lwd=5) {
    L(x+c(-.5,.5)*size,base::rep(y,2),col,lwd);L(base::rep(x,2),y+c(-.5,.5)*size,col,lwd)
  }
  list(P=P,L=L,C=C,B=B,A=A,Q=Q,H=H,slab=slab,cell=cell,node=node,
       capsule=capsule,disc=disc,check=check,plus=plus)
}
