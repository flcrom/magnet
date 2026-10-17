import json,math,numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
data=json.load(open("/tmp/train_raw_all.json")); sess={}
for v in data.values(): sess.setdefault(v["session"],{})[v["step"]]=v
def rot(q,v,inv=False):
    x,y,z,w=q
    if inv:x,y,z=-x,-y,-z
    vx,vy,vz=v;tx=2*(y*vz-z*vy);ty=2*(z*vx-x*vz);tz=2*(x*vy-y*vx)
    return np.array([vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)])
def load(sid):
    S=sess[sid]; b0=np.mean([rot(f[2],f[1]) for f in S[0]["frames"]],axis=0); M=[];SD=[]
    for s in range(1,25):
        r=np.array([np.array(f[1])-rot(f[2],b0,True) for f in S[s]["frames"]]); M.append(r.mean(0)); SD.append(r.std(0).mean())
    return np.array(M),np.array(SD)
M1,S1=load("smvcsno5y"); M2,S2=load("pass2"); T=np.arange(24)*15
ang=lambda M:np.degrees(np.arctan2(M[:,0],M[:,1]))%360
plt.style.use("dark_background"); fig,ax=plt.subplots(2,3,figsize=(18,11))
c1,c2="#ffffff","#ffb000"
for row,(zoom,title) in enumerate(((1,"all"),(0,"zoom: steps 1-19 (strong ones clipped)"))):
    a=ax[row,0]; a.set_aspect("equal"); lim=max(abs(M1[:,:2]).max(),abs(M2[:,:2]).max())*1.1 if zoom else 130
    for t in T: a.plot([0,math.sin(math.radians(t))*lim*.95],[0,math.cos(math.radians(t))*lim*.95],color="#2a2a2a",lw=.7)
    for M,c in ((M1,c1),(M2,c2)):
        for m in M: a.annotate("",xy=(m[0],m[1]),xytext=(0,0),arrowprops=dict(arrowstyle="->",color=c,lw=1))
    a.set_xlim(-lim,lim);a.set_ylim(-lim,lim);a.set_title(f"residual vectors in screen plane (uT), {title}\nwhite = pass 1, amber = pass 2",fontsize=9);a.grid(color="#222")
    a=ax[row,1]; a.plot(T,ang(M1),"o",color=c1,label="pass 1");a.plot(T,ang(M2),"s",color=c2,mfc="none",label="pass 2");a.plot([0,345],[0,345],color="#555");a.legend();a.set_xlabel("target direction (deg)");a.set_ylabel("measured in-plane angle (deg)");a.set_title("angle: measured vs target",fontsize=9);a.grid(color="#222")
    a=ax[row,2]; w=3.2
    for k,(lab) in enumerate(("x (right)","y (up)","z (out)")):
        a.bar(T-w/2-0.0,M1[:,k],w,color=c1,alpha=[1,.65,.35][k]) if False else None
    a.plot(T,M1[:,0],"-o",color="#ffffff",ms=3,label="x p1");a.plot(T,M2[:,0],"--s",color="#ffb000",ms=3,label="x p2")
    a.plot(T,M1[:,1],"-o",color="#9ad",ms=3,label="y p1");a.plot(T,M2[:,1],"--s",color="#f66",ms=3,label="y p2")
    a.plot(T,M1[:,2],"-o",color="#8e8",ms=3,label="z p1");a.plot(T,M2[:,2],"--s",color="#fd8",ms=3,label="z p2")
    if not zoom: pass
    else: a.set_ylim(-130,130)
    a.legend(fontsize=7,ncol=3);a.set_xlabel("target direction (deg)");a.set_ylabel("uT");a.set_title("components per direction, pass 1 vs pass 2"+("" if not zoom else " (zoom +-130)"),fontsize=9);a.grid(color="#222")
plt.tight_layout();plt.savefig("/downloads/magnet-sidebyside.png",dpi=120);print("ok")
