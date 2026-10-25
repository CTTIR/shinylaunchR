# Forty-five bespoke vector illustrations, including two user-named suites.
# Larger shapes define the silhouette. Secondary marks disappear in small icons.
# The drawings are conceptual package identities, not scientific measurements.
cttir_motif <- function(name,s,small=FALSE) {
  base::list2env(cttir_primitives(s,small),envir=base::environment())
  a<-s$mid; p<-s$paper; l<-s$light; d<-s$deep; e<-s$edge

  # SPECTRAL: data cubes, optical acquisition and spectral composition.
  if(name=="hyperloom") {
    # A spectral cube whose crossing bands visibly alternate over and under.
    # UV coordinates map a rectangular weave onto the upper isometric plane.
    uv<-function(u,v,fill,shadow=FALSE) P(.5+.36*(u-v),.86-.18*(u+v),fill,shadow=shadow)
    P(c(.14,.50,.50,.14),c(.68,.50,.19,.37),d,shadow=TRUE)
    P(c(.50,.86,.86,.50),c(.50,.68,.37,.19),a,shadow=TRUE)
    centers<-if(small)c(.25,.75) else c(.17,.5,.83)
    half<-if(small).15 else .105
    for(i in base::seq_along(centers)) {
      z<-centers[i]+c(-half,half)
      # Continue the woven bands down both cube faces.
      P(.14+.36*c(z[1],z[2],z[2],z[1]),
        .68-.18*c(z[1],z[2],z[2],z[1])-c(0,0,.31,.31),c(l,p,a)[i])
      P(.5+.36*c(z[1],z[2],z[2],z[1]),
        .5+.18*c(z[1],z[2],z[2],z[1])-c(0,0,.31,.31),c(a,l,p)[i])
    }
    uv(c(0,1,1,0),c(0,0,1,1),d)
    for(i in base::seq_along(centers)) {
      z<-centers[i]+c(-half,half)
      uv(c(z[1],z[2],z[2],z[1]),c(0,0,1,1),c(l,p,a)[i])
    }
    for(j in base::seq_along(centers)) {
      z<-centers[j]+c(-half,half)
      uv(c(0,1,1,0),c(z[1],z[1],z[2],z[2]),c(a,l,p)[j])
    }
    for(i in base::seq_along(centers))for(j in base::seq_along(centers)) {
      if((i+j)%%2==0) {
        uu<-centers[i]+c(-half,half);vv<-centers[j]+c(-half,half)
        uv(c(uu[1],uu[2],uu[2],uu[1]),c(vv[1],vv[1],vv[2],vv[2]),c(l,p,a)[i])
      }
    }
    if(!small) {
      L(c(.14,.50,.86),c(.68,.86,.68),p,1.5)
      L(c(.50,.50),c(.49,.20),l,1.5)
    }
  } else if(name=="phenoloom") {
    # Soft tissue threads alternate at crossings. Cells fill the four gaps.
    ribbon<-function(x,y,width,fill,caps=TRUE,shadow=TRUE) {
      dx<-c(base::diff(x),utils::tail(base::diff(x),1))
      dy<-c(base::diff(y),utils::tail(base::diff(y),1))
      length<-base::sqrt(dx^2+dy^2);nx<--dy/length;ny<-dx/length
      P(c(x+nx*width/2,base::rev(x-nx*width/2)),
        c(y+ny*width/2,base::rev(y-ny*width/2)),fill,shadow=shadow)
      if(caps) {
        C(x[1],y[1],width/2,fill,col=fill,lwd=.8)
        C(utils::tail(x,1),utils::tail(y,1),width/2,fill,col=fill,lwd=.8)
      }
    }
    tt<-base::seq(.14,.86,length.out=100)
    centers<-c(.20,.50,.80);width<-.09
    vx<-function(t,x0)x0+.018*base::sin((t-.14)*2*pi)
    hy<-function(t,y0)y0+.018*base::cos((t-.14)*2*pi)
    for(i in 1:3)ribbon(vx(tt,centers[i]),tt,width,c(l,p,a)[i])
    for(j in 1:3)ribbon(tt,hy(tt,centers[j]),width,c(a,l,p)[j])
    for(i in 1:3)for(j in 1:3)if((i+j)%%2==0) {
      yy<-hy(centers[i],centers[j]);part<-base::seq(yy-.065,yy+.065,length.out=25)
      ribbon(vx(part,centers[i]),part,width,c(l,p,a)[i],caps=FALSE,shadow=FALSE)
    }
    xy<-base::rbind(c(.35,.35),c(.65,.35),c(.35,.65),c(.65,.65))
    for(i in 1:4)cell(xy[i,1],xy[i,2],.085,c(a,l,p,a)[i],i)
  } else if(name=="hyperspectR") {
    slab(.5,.31,.73,.34,.065,d)
    slab(.5,.43,.73,.34,.045,a)
    slab(.5,.55,.73,.34,.045,l)
    slab(.5,.70,.73,.34,.07,p,grid=TRUE)
    P(c(.5,.865,.865,.5),c(.53,.70,.63,.46),a)
    if(!small) for(t in c(.2,.4,.6,.8)) L(c(.5+.365*t,.5+.365*t),c(.53+.17*t,.46+.17*t),l,2)
    L(c(.14,.14),c(.32,.70),l,2);C(.14,.70,.019,p)
  } else if(name=="cuvis.r") {
    slab(.48,.28,.76,.33,.06,d,TRUE)
    P(c(.21,.69,.80,.32),c(.46,.46,.57,.57),l,shadow=TRUE)
    B(.46,.61,.49,.34,a,.04,shadow=TRUE)
    P(c(.705,.81,.81,.705),c(.44,.55,.85,.78),d)
    P(c(.215,.32,.81,.705),c(.78,.87,.87,.78),l)
    disc(.46,.61,.185,p);C(.46,.62,.13,d);C(.46,.62,.087,a);C(.46,.62,.041,p)
    if(!small) {A(.46,.62,.10,10,135,l,3);B(.65,.735,.045,.021,p,.008)}
  } else if(name=="hyperannotatR") {
    slab(.48,.34,.76,.37,.05,d)
    slab(.48,.49,.76,.37,.045,l,TRUE)
    P(c(.28,.43,.70,.58,.32),c(.50,.65,.54,.38,.40),a)
    L(c(.28,.43,.70,.58,.32,.28),c(.50,.65,.54,.38,.40,.50),p,3)
    for(i in 1:5) C(c(.28,.43,.70,.58,.32)[i],c(.50,.65,.54,.38,.40)[i],.025,p)
    # An angled stylus points at the selected polygon.
    P(c(.65,.74,.88,.79),c(.59,.55,.86,.90),p,shadow=TRUE)
    P(c(.65,.74,.63),c(.59,.55,.50),a)
    P(c(.79,.88,.90,.81),c(.90,.86,.90,.94),a)
  } else if(name=="hypermodR") {
    slab(.39,.63,.50,.25,.05,a)
    slab(.39,.76,.50,.25,.06,p,TRUE)
    L(c(.39,.39,.73,.73),c(.48,.40,.40,.29),l,4)
    L(c(.19,.19,.39),c(.28,.40,.40),l,4)
    L(c(.46,.46),c(.4,.25),l,4)
    for(i in 1:3) H(c(.19,.46,.73)[i],.22,.095,if(i==2)p else a,TRUE)
    B(.73,.59,.25,.25,d,.035,col=e,shadow=TRUE)
    Q(c(.64,.69,.76,.83),c(.52,.52,.71,.64),p,4)
  } else if(name=="hyperspectaculR") {
    # Folded spectral pinwheel: repeated bands create an art-focused silhouette.
    for(i in 0:11) {
      t <- i*pi/6; r1 <- .14; r2 <- .38
      xx<-c(r1*base::cos(t),r2*base::cos(t+.12),r2*.78*base::cos(t+.50),r1*base::cos(t+.52))+.5
      yy<-c(r1*base::sin(t),r2*base::sin(t+.12),r2*.78*base::sin(t+.50),r1*base::sin(t+.52))+.52
      P(xx,yy,c(a,l,p,d)[i%%4+1],shadow=TRUE)
    }
    H(.5,.52,.145,p,TRUE);H(.5,.52,.077,a)
  } else if(name=="libscanR") {
    slab(.48,.25,.75,.30,.065,a,TRUE)
    P(c(.44,.52,.54,.42),c(.86,.86,.42,.42),cttir_alpha(l,.3))
    B(.48,.85,.24,.12,p,.025,shadow=TRUE);B(.48,.78,.09,.05,a,.01)
    L(c(.48,.48),c(.76,.38),p,5);C(.48,.36,.045,p)
    for(i in 0:4) L(c(.53,.68+i*.035),c(.40,.49+i*.065),if(i%%2)p else a,3)
    if(!small) for(i in 0:3) B(.74+i*.045,.74+i*.025,.021,.10+i*.025,l,.008)
  } else if(name=="tivis.r") {
    slab(.40,.42,.68,.40,.065,l)
    cell(.31,.47,.075,a,1);cell(.48,.45,.064,d,2);cell(.42,.57,.054,a,3)
    B(.72,.68,.29,.34,p,.03,shadow=TRUE)
    L(c(.62,.62,.82),c(.79,.55,.55),d,2)
    Q(c(.63,.66,.69,.72),c(.57,.57,.91,.59),a,4)
    Q(c(.72,.76,.77,.81),c(.59,.83,.65,.62),a,4)
    L(c(.51,.59),c(.52,.57),p,3,arrow=TRUE)

  # SPATIAL BIOLOGY: tissue, segmentation, assay and flow each have a new mark.
  } else if(name=="phenoscapR") {
    xy <- base::rbind(c(.28,.68),c(.53,.76),c(.75,.61),c(.69,.32),c(.40,.26),c(.22,.43))
    L(c(xy[,1],xy[1,1]),c(xy[,2],xy[1,2]),d,9)
    for(i in 1:6) {L(c(.48,xy[i,1]),c(.51,xy[i,2]),l,2);cell(xy[i,1],xy[i,2],.105,c(a,l,a,d,l,a)[i],i)}
    cell(.48,.51,.14,p,2,FALSE);C(.48,.51,.058,a);C(.467,.527,.021,l)
    if(!small) {C(.18,.71,.018,p);C(.78,.38,.021,l);C(.59,.18,.014,p)}
  } else if(name=="segmantR") {
    cell(.38,.57,.245,a,1);cell(.65,.43,.225,l,2)
    P(c(.44,.51,.46,.57,.52,.60),c(.84,.68,.55,.44,.31,.18),s$face)
    L(c(.49,.55,.50,.60,.56),c(.84,.68,.55,.42,.19),p,4)
    if(!small) {
      L(c(.17,.17,.26),c(.69,.81,.81),p,3)
      L(c(.79,.86,.86),c(.22,.22,.33),p,3)
      for(i in 0:3) C(.58+i*.07,.68-i*.035,.014,p)
    }
  } else if(name=="cellspecR") {
    cell(.34,.56,.235,a,2);C(.32,.58,.078,d);C(.30,.61,.028,p)
    B(.71,.47,.32,.47,p,.035,shadow=TRUE)
    for(i in 0:2) for(j in 0:3) B(.615+i*.096,.31+j*.105,.067,.075,
      c(l,a,d,p)[(i+2*j)%%4+1],.012)
    L(c(.50,.56),c(.57,.57),p,3)
    if(!small) {A(.34,.56,.28,75,180,l,2);C(.34,.84,.022,p)}
  } else if(name=="gatekeepR") {
    # A genuine cytometry-like gate and a separate, selected output cluster.
    L(c(.14,.14,.58),c(.85,.24,.24),l,3)
    xy<-base::rbind(c(.24,.40),c(.29,.47),c(.22,.61),c(.32,.68),c(.39,.59),c(.38,.46),c(.47,.71))
    for(i in 1:7) C(xy[i,1],xy[i,2],.026,if(i%%2)a else l)
    L(c(.28,.43,.50,.42,.28),c(.53,.78,.62,.45,.53),p,4)
    L(c(.52,.69),c(.57,.57),p,4,arrow=TRUE)
    cell(.78,.67,.082,a,1);cell(.76,.43,.078,l,3);cell(.87,.54,.060,a,2)
  } else if(name=="cellreportR") {
    # A microscope slide combines a cellular specimen with an analytical trace.
    B(.52,.51,.67,.51,p,.04,shadow=TRUE)
    B(.26,.51,.15,.51,l,.025)
    cell(.47,.60,.118,a,2);cell(.68,.59,.073,d,1)
    L(c(.40,.73),c(.31,.31),d,2)
    for(i in 0:3) B(.43+i*.087,.35+c(.04,.08,.11,.06)[i+1],.047,
      c(.08,.16,.22,.12)[i+1],a,.009)
    if(!small) {L(c(.22,.29),c(.63,.63),d,2);L(c(.22,.29),c(.56,.56),d,2)}
  } else if(name=="bloodspottR") {
    # Histology burden: cellular blood spots within a calibrated specimen frame.
    B(.5,.5,.72,.56,l,.04,shadow=TRUE)
    for(i in 1:5) disc(c(.30,.52,.72,.40,.66)[i],c(.65,.65,.57,.40,.35)[i],
      c(.085,.11,.065,.095,.085)[i],a)
    if(!small) for(i in 0:4) L(c(.22+i*.055,.22+i*.055),c(.24,.26),d,2)
    L(c(.15,.15,.25),c(.76,.84,.84),p,3);L(c(.75,.85,.85),c(.17,.17,.25),p,3)
  } else if(name=="qupflowR") {
    slab(.28,.42,.33,.20,.035,l);cell(.28,.43,.055,a,1)
    slab(.74,.42,.33,.20,.035,p)
    P(c(.68,.74,.80,.74),c(.42,.46,.42,.38),a)
    Q(c(.29,.37,.67,.73),c(.63,.91,.91,.63),p,6)
    P(c(.68,.77,.79),c(.65,.60,.70),p)
    Q(c(.72,.63,.37,.28),c(.28,.03,.03,.28),a,6)
    P(c(.22,.25,.33),c(.24,.33,.26),a)
    B(.51,.47,.15,.14,a,.035,shadow=TRUE);check(.51,.48,.08,p,3)
  } else if(name=="mssrscopR") {
    # Separated optical peaks replace the previous generic chart-window symbol.
    L(c(.13,.13,.87),c(.77,.26,.26),l,2)
    x<-base::seq(.15,.85,length.out=150)
    broad<-.27+.32*base::exp(-((x-.50)/.23)^2)
    P(c(x,base::rev(x)),c(broad,base::rep(.27,150)),cttir_alpha(l,.4))
    sharp<-.27+.47*base::exp(-((x-.36)/.065)^2)+.47*base::exp(-((x-.65)/.065)^2)
    P(c(x,base::rev(x)),c(sharp,base::rep(.27,150)),a)
    L(x,sharp,p,3)
    if(!small) {C(.36,.78,.026,p);C(.65,.78,.026,p);L(c(.42,.59),c(.83,.83),l,2)}

  # MOLECULAR DATA: transcript strands and a multiplex assay plate.
  } else if(name=="bambamR") {
    for(i in 0:3) {
      yy<-.29+i*.145
      Q(c(.20,.36,.61,.80),c(yy+.08,yy+.19,yy-.10,yy+.03),if(i%%2)p else a,9)
      if(!small) for(t in c(.30,.42,.56,.70)) B(t,yy+.05,.055,.058,if(i%%2)l else p,.012)
    }
    L(c(.17,.17),c(.22,.86),l,3)
  } else if(name=="qviewparsR") {
    B(.5,.51,.79,.59,d,.055,shadow=TRUE)
    B(.5,.55,.77,.59,l,.055)
    for(i in 0:4) for(j in 0:3) {
      x<-.215+i*.143;y<-.34+j*.141
      C(x,y,.052,d);C(x,y+.009,.042,if((i+j)%%3==0)p else a)
      if(!small) C(x-.012,y+.023,.011,p)
    }
    L(c(.18,.82),c(.21,.21),p,2)

  # CLINICAL SCIENCE: pathology, plantar pressure, cord imaging and audit.
  } else if(name=="molpathR") {
    for(i in 0:1) {
      t<-base::seq(0,1,length.out=100); x<-.30+.115*base::sin(t*2*pi+i*pi)
      L(x,.21+.63*t,if(i==0)p else a,7)
    }
    if(!small) for(t in base::seq(.08,.94,length.out=7))
      L(.30+c(-1,1)*.115*base::sin(t*2*pi),base::rep(.21+.63*t,2),l,3)
    L(c(.42,.62,.78),c(.51,.65,.51),p,3);L(c(.62,.62),c(.65,.82),p,3)
    L(c(.62,.73),c(.65,.30),p,3)
    for(i in 1:4) node(c(.62,.78,.62,.73)[i],c(.65,.51,.82,.30)[i],c(.08,.065,.055,.07)[i],c(a,l,p,a)[i])
  } else if(name=="pressR") {
    # Rounded insole with concentric pressure islands, never red/green coding.
    t<-base::seq(0,2*pi,length.out=180)
    x<-.47+.20*base::cos(t)*(1+.16*base::sin(t));y<-.49+.34*base::sin(t)
    P(x,y,l,shadow=TRUE)
    C(.45,.32,.105,a);C(.45,.32,.061,d);C(.45,.32,.027,p)
    C(.48,.68,.137,a);C(.48,.68,.088,d);C(.48,.68,.042,p)
    Q(c(.45,.64,.33,.49),c(.29,.44,.54,.70),p,3)
    for(i in 0:3) C(.66+i*.037,.76-i*.06,.027-i*.003,a)
    if(!small) L(c(.73,.80),c(.30,.30),p,3)
  } else if(name=="scimagR") {
    B(.50,.51,.65,.68,d,.045,shadow=TRUE)
    B(.50,.53,.62,.68,l,.045)
    # Repeated vertebral volumes surround a continuous spinal cord.
    for(i in 0:4) {
      xx<-.49+.025*base::sin(i);yy<-.29+i*.116
      B(xx,yy,.22,.082,p,.028,shadow=TRUE)
      P(xx+c(-.11,-.18,-.11),yy+c(.025,0,-.025),a)
      P(xx+c(.11,.18,.11),yy+c(.025,0,-.025),a)
    }
    Q(c(.50,.58,.42,.52),c(.24,.40,.67,.81),a,5)
    C(.50,.53,.045,d);C(.50,.53,.021,p)
  } else if(name=="zhncommandR") {
    B(.5,.55,.76,.56,p,.045,shadow=TRUE)
    B(.5,.78,.76,.10,l,.03)
    disc(.29,.58,.105,a);C(.29,.59,.048,p)
    for(i in 0:2) B(.50+i*.105,.59,.069,.18*c(.6,1,.8)[i+1],a,.012)
    L(c(.22,.41,.41,.55,.55,.74),c(.39,.39,.35,.35,.31,.31),d,4)
    B(.72,.24,.24,.18,a,.04,shadow=TRUE);check(.72,.25,.12,p,5)

  # METHODS: geometric inference and distinct evolving representation motifs.
  } else if(name=="inferguidR") {
    A(.49,.51,.31,0,360,l,4);A(.49,.51,.255,210,350,a,9)
    for(i in 0:7) {t<-i*pi/4;L(.49+c(.325,.355)*base::cos(t),.51+c(.325,.355)*base::sin(t),p,2)}
    P(c(.29,.53,.71,.47),c(.26,.47,.79,.55),a,shadow=TRUE)
    P(c(.47,.53,.71),c(.55,.47,.79),p)
    C(.49,.51,.045,d);C(.49,.51,.021,p)
  } else if(name=="songR") {
    # A continuous folded neighbourhood lattice; the negative spaces remain clear.
    for(j in 0:3) {
      x<-base::seq(.18,.83,length.out=70)
      y<-.29+j*.12+.15*base::sin((x-.18)*2*pi)
      L(x,y,if(j%%2)l else a,2.5)
    }
    for(i in 0:5) {
      x<-.18+i*.13; yy<-.29+.15*base::sin((x-.18)*2*pi)
      L(base::rep(x,2),c(yy,yy+.36),l,2)
      for(j in 0:3) node(x,yy+j*.12,if(i%%2).025 else .032,if(j%%2)p else a)
    }
  } else if(name=="sorenR") {
    xy<-base::rbind(c(.19,.54),c(.34,.76),c(.45,.47),c(.35,.25),c(.65,.68),c(.78,.42),c(.63,.23))
    ed<-base::rbind(c(1,2),c(1,3),c(1,4),c(2,3),c(2,5),c(3,4),c(3,5),c(3,6),c(4,7),c(5,6),c(6,7))
    for(i in base::seq_len(base::nrow(ed))) L(xy[ed[i,],1],xy[ed[i,],2],l,2.5)
    for(i in 1:7) node(xy[i,1],xy[i,2],if(i==3).085 else .054,if(i%%2)a else p)
    A(.73,.76,.14,10,230,p,2.5);C(.85,.84,.043,p);L(c(.76,.83),c(.72,.80),a,3)

  # SIMULATION: loops, tabletop terrain and resilient systems.
  } else if(name=="dynasimR") {
    A(.5,.51,.30,30,145,p,5);A(.5,.51,.30,155,270,a,5);A(.5,.51,.30,280,395,l,5)
    for(i in 0:2) {t<-(90+i*120)*pi/180;H(.5+.30*base::cos(t),.51+.30*base::sin(t),.10,c(a,p,l)[i+1],TRUE)}
    x<-base::seq(.30,.70,length.out=100);L(x,.51+.085*base::sin((x-.3)*5*pi),p,4)
    if(!small) L(c(.30,.70),c(.39,.39),a,2)
  } else if(name=="sandtablR") {
    slab(.5,.43,.82,.43,.08,l,TRUE)
    L(c(.22,.45,.51,.76),c(.43,.54,.41,.51),d,4)
    H(.22,.44,.063,a,TRUE);B(.51,.44,.105,.105,p,.015,shadow=TRUE)
    P(c(.70,.76,.82),c(.51,.63,.51),a,shadow=TRUE)
    B(.46,.72,.15,.15,p,.03,shadow=TRUE);plus(.46,.72,.09,d,3)
    L(c(.46,.46),c(.65,.55),p,3)
  } else if(name=="shieldR") {
    P(c(.18,.5,.82,.76,.65,.5,.35,.24),c(.79,.89,.79,.44,.28,.17,.28,.44),l,shadow=TRUE)
    P(c(.5,.78,.72,.61,.5),c(.85,.76,.44,.29,.21),a)
    L(c(.33,.49,.67),c(.62,.38,.60),d,4)
    L(c(.33,.67),c(.62,.60),d,4)
    for(i in 1:3) node(c(.33,.49,.67)[i],c(.62,.38,.60)[i],.065,p)
    if(!small) L(c(.27,.5,.73),c(.74,.81,.74),p,2)

  # EVIDENCE: consensus, idea exchange, monitoring and citation topology.
  } else if(name=="brainwritR") {
    A(.50,.50,.29,25,330,a,4)
    for(i in 0:2) {
      t<-(90+i*120)*pi/180;x<-.5+.29*base::cos(t);y<-.5+.29*base::sin(t)
      B(x,y,.24,.17,c(p,l,a)[i+1],.04,shadow=TRUE)
      P(x+c(-.065,-.04,.015),y+c(-.06,-.13,-.06),c(p,l,a)[i+1])
      if(!small) {L(x+c(-.06,.06),base::rep(y+.025,2),d,2);L(x+c(-.06,.02),base::rep(y-.025,2),d,2)}
    }
    # A central pencil makes creation, rather than collection, the visual verb.
    P(c(.44,.50,.62,.56),c(.37,.34,.62,.65),p,shadow=TRUE)
    P(c(.44,.50,.41),c(.37,.34,.29),a)
  } else if(name %in% c("delphyr","delphyrApp")) {
    if(name=="delphyrApp") {
      B(.5,.51,.79,.67,d,.05,col=e,shadow=TRUE)
      B(.5,.81,.79,.10,l,.035)
      for(x in c(.19,.25,.31)) C(x,.81,.013,d)
      grid::pushViewport(grid::viewport(.5,.49,.81,.81))
    }
    for(i in 0:4) {
      t<-(90+i*72)*pi/180; x<-.5+.30*base::cos(t);y<-.5+.30*base::sin(t)
      L(c(.5,x),c(.5,y),l,4)
      B(x,y,.15,.12,if(i%%2)p else a,.035,shadow=TRUE)
      if(!small) L(x+c(-.035,.035),base::rep(y,2),d,2)
    }
    H(.5,.5,.15,p,TRUE);check(.5,.51,.16,d,6)
    if(name=="delphyrApp") grid::popViewport()
  } else if(name=="researchR") {
    C(.48,.5,.29,d);A(.48,.5,.29,0,360,l,2);A(.48,.5,.19,0,360,l,1.7)
    P(c(.48,.48,.75),c(.50,.79,.61),cttir_alpha(a,.45))
    L(c(.48,.75),c(.5,.61),p,4)
    for(i in 1:3) C(c(.33,.62,.57)[i],c(.56,.65,.34)[i],.030,p)
    B(.25,.26,.23,.20,p,.025,shadow=TRUE)
    L(c(.19,.31),c(.29,.29),d,3);L(c(.19,.27),c(.24,.24),a,3)
    if(!small) L(c(.48,.48),c(.16,.22),p,2)
  } else if(name=="scimapR") {
    xy<-base::rbind(c(.25,.70),c(.50,.80),c(.74,.65),c(.32,.43),c(.62,.39),c(.47,.20))
    ed<-base::rbind(c(1,2),c(2,3),c(1,4),c(2,4),c(3,5),c(4,5),c(4,6),c(5,6),c(2,5))
    for(i in 1:9) L(xy[ed[i,],1],xy[ed[i,],2],a,3)
    for(i in 1:6) {
      H(xy[i,1],xy[i,2],if(i==4).105 else .075,if(i%%2)p else l,TRUE)
      if(!small) L(xy[i,1]+c(-.025,.025),base::rep(xy[i,2],2),d,2)
    }

  # RESEARCH INFRASTRUCTURE: a recognisable material-object vocabulary.
  } else if(name=="cttiR") {
    slab(.56,.41,.62,.32,.14,a,TRUE)
    slab(.56,.68,.62,.32,.06,p,TRUE)
    L(c(.25,.13,.13,.25),c(.59,.59,.31,.31),l,3)
    for(y in c(.31,.45,.59)) H(.13,y,.043,p)
    P(c(.56,.87,.87,.56),c(.52,.68,.62,.46),a)
    if(!small) {L(c(.62,.79),c(.56,.64),l,2);L(c(.62,.74),c(.51,.57),l,2)}
  } else if(name=="harbouR") {
    # Stacked containers over a sheltered quay, with an anchor stem.
    slab(.5,.28,.79,.33,.06,d)
    for(i in 0:2) {
      B(.5,.38+i*.145,.55,.105,c(a,l,p)[i+1],.025,shadow=TRUE)
      if(!small) for(x in c(.29,.35,.41,.47)) L(base::rep(x,2),.38+i*.145+c(-.025,.025),d,1.5)
    }
    C(.5,.86,.045,p);C(.5,.86,.020,d)
    L(c(.5,.5),c(.81,.75),p,3)
    L(c(.17,.17,.5,.83,.83),c(.38,.25,.16,.25,.38),p,4)
  } else if(name=="hexmakR") {
    H(.43,.52,.30,a,TRUE);H(.43,.52,.235,l);H(.43,.52,.165,p)
    P(c(.53,.64,.87,.76),c(.28,.23,.72,.78),a,shadow=TRUE)
    P(c(.53,.64,.49),c(.28,.23,.15),p)
    P(c(.76,.87,.90,.79),c(.78,.72,.79,.85),p)
    if(!small) L(c(.61,.81),c(.34,.75),l,2)
  } else if(name=="reflowR") {
    slab(.48,.38,.60,.27,.06,a)
    slab(.48,.54,.60,.27,.06,p)
    A(.48,.51,.36,35,155,p,5);A(.48,.51,.36,215,335,a,5)
    P(c(.15,.11,.23),c(.68,.58,.61),p)
    P(c(.81,.86,.74),c(.34,.44,.42),a)
    if(!small) {L(c(.40,.54),c(.57,.64),d,2);L(c(.46,.60),c(.54,.61),d,2)}
  } else if(name=="themakR") {
    # Three fanned swatch cards, with a strong typographic layout on the top.
    P(c(.15,.33,.64,.46),c(.34,.81,.69,.22),d,shadow=TRUE)
    P(c(.30,.43,.77,.64),c(.25,.80,.72,.17),a,shadow=TRUE)
    B(.61,.52,.34,.61,p,.035,shadow=TRUE)
    B(.61,.71,.23,.13,l,.012)
    L(c(.53,.69),c(.58,.58),d,5);L(c(.53,.65),c(.52,.52),d,3)
    for(i in 0:2) B(.54+i*.07,.37,.045,.07,c(d,a,l)[i+1],.009)
  } else if(name=="shinylaunchR") {
    # A launcher arrow becomes a dimensional rocket over an app tile.
    B(.46,.45,.57,.55,d,.06,col=e,shadow=TRUE)
    for(i in 0:1) for(j in 0:1) B(.31+i*.16,.31+j*.16,.105,.105,a,.025)
    P(c(.40,.55,.83,.71),c(.45,.72,.88,.58),p,shadow=TRUE)
    P(c(.55,.71,.83),c(.72,.58,.88),l)
    P(c(.41,.52,.41,.30),c(.49,.59,.62,.49),a)
    P(c(.58,.68,.65,.53),c(.43,.55,.34,.29),a)
    C(.65,.69,.052,d);C(.65,.69,.028,a)
    L(c(.39,.26),c(.41,.27),p,5)

  # COMPANION APPLICATIONS: retain clear links to their actual operations.
  } else if(name=="argus-one") {
    # An observant eye with a central convergence point.
    Q(c(.13,.30,.70,.87),c(.51,.87,.87,.51),p,6)
    Q(c(.13,.30,.70,.87),c(.51,.15,.15,.51),a,6)
    disc(.50,.51,.19,l);C(.50,.52,.115,d);C(.50,.52,.059,a);C(.47,.56,.025,p)
    if(!small) for(i in 0:2) L(c(.32+i*.18,.32+i*.18),c(.84,.91),l,3)
  } else if(name=="attaclone-dedup") {
    B(.36,.60,.37,.48,a,.035,shadow=TRUE)
    B(.60,.44,.37,.48,p,.035,shadow=TRUE)
    # Matching attachment loops, followed by a single retained check seal.
    A(.36,.63,.075,0,310,l,4);A(.60,.51,.075,0,310,d,4)
    disc(.73,.27,.12,a);check(.73,.28,.12,d,5)
    if(!small) {L(c(.25,.43),c(.44,.44),l,3);L(c(.49,.65),c(.34,.34),a,3)}
  } else if(name=="metadata-mender") {
    B(.46,.52,.55,.65,p,.04,shadow=TRUE)
    for(i in 0:3) {
      yy<-.72-i*.13
      B(.29,yy,.065,.065,a,.014)
      L(c(.38,if(i==2).46 else .63),base::rep(yy,2),d,3)
    }
    # A missing structured field is restored by an offset repair tile.
    B(.70,.47,.23,.23,a,.035,shadow=TRUE);plus(.70,.47,.13,d,5)
    if(!small) L(c(.57,.60),c(.46,.46),a,3,lty=2)
  } else if(name=="pwa-quest") {
    B(.47,.52,.39,.70,l,.055,shadow=TRUE)
    B(.47,.53,.32,.57,p,.025)
    B(.47,.81,.14,.026,d,.012)
    for(i in 0:2) {
      B(.38,.68-i*.13,.045,.045,a,.010)
      L(c(.44,.57),base::rep(.68-i*.13,2),d,3)
    }
    disc(.70,.32,.135,a);check(.70,.33,.15,d,6)
  } else if(name=="CTTIR") {
    # Three faceted scientific domains join to form a single impossible cube.
    P(c(.50,.82,.65,.50,.35,.18),c(.88,.70,.60,.69,.60,.70),p,shadow=TRUE)
    P(c(.18,.35,.35,.50,.50,.18),c(.70,.60,.40,.31,.12,.30),l,shadow=TRUE)
    P(c(.50,.50,.65,.65,.82,.82),c(.12,.31,.40,.60,.70,.30),a,shadow=TRUE)
    H(.5,.5,.145,s$face)
    if(!small) {L(c(.5,.78),c(.83,.67),l,2);L(c(.22,.22),c(.64,.33),p,2)}
  } else base::stop("No original motif registered for: ",name)
  base::invisible(NULL)
}
