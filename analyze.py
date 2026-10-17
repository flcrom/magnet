import json,math,sys,urllib.request
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
room=sys.argv[1] if len(sys.argv)>1 else "PIXEL6A"
data=json.load(urllib.request.urlopen(urllib.request.Request(f"https://magnet.flcrom.dev/rec?room={room}",headers={"User-Agent":"Mozilla/5.0"})))
json.dump(data,open("/tmp/train_raw.json","w"))
sess={}
for k,v in data.items(): sess.setdefault(v["session"],{})[v["step"]]=v
sid=sys.argv[2] if len(sys.argv)>2 else max(sess,key=lambda s:(len(sess[s]),max(r["ts"] for r in sess[s].values())))
OUT=sys.argv[3] if len(sys.argv)>3 else "/downloads/magnet-train-24.png"
S=sess[sid]; print("session",sid,"recordings",len(S),"steps",sorted(S))
def rot(q,v,inv=False):
    x,y,z,w=q
    if inv:x,y,z=-x,-y,-z
    vx,vy,vz=v
    tx=2*(y*vz-z*vy);ty=2*(z*vx-x*vz);tz=2*(x*vy-y*vx)
    return np.array([vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)])
def world(rec): return np.mean([rot(f[2],f[1]) for f in rec["frames"]],axis=0)
b0=world(S[0]); far=world(S[max(S)]) if max(S)>=25 else None
print("baseline world field",b0.round(1),"|B|",round(float(np.linalg.norm(b0)),1))
if far is not None: print("far check minus baseline",(far-b0).round(2),"drift uT",round(float(np.linalg.norm(far-b0)),2))
# per direction
rows=[]
for s in range(1,25):
    if s not in S: continue
    r=S[s]; res=np.array([np.array(f[1])-rot(f[2],b0,True) for f in r["frames"]])
    mean=res.mean(0); sd=res.std(0)
    ang=math.degrees(math.atan2(mean[0],mean[1]))%360
    rows.append(dict(step=s,target=r["angleDeg"],mean=mean,sd=sd,mag=float(np.linalg.norm(mean)),inplane=float(np.hypot(mean[0],mean[1])),ang=ang,res=res,n=len(res),
        tilt=float(np.degrees(2*np.arccos(min(1,abs(np.mean([f[2][3] for f in r["frames"]])))))) ))
print("\nstep target  mean_x   mean_y   mean_z   |r|   inplane  meas_ang  sd(xyz)  n")
for d in rows: print(f"{d['step']:>3} {d['target']:>5.0f} {d['mean'][0]:>8.1f} {d['mean'][1]:>8.1f} {d['mean'][2]:>8.1f} {d['mag']:>6.1f} {d['inplane']:>6.1f} {d['ang']:>8.0f} {d['sd'].round(1)} {d['n']}")
T=np.array([d["target"] for d in rows]); A=np.array([d["ang"] for d in rows])
def cerr(a,b): return (a-b+180)%360-180
res={}
for flip in (1,-1):
    best=None
    for off in range(0,360,1):
        e=np.abs(cerr(flip*(A)+off,T)); m=float(np.median(e)); 
        if best is None or m<best[0]: best=(m,off,float(np.mean(e)),float(e.max()))
    res[flip]=best
    print(f"in-plane angle vs target, sign {flip:+d}: best offset {best[1]} deg, median |err| {best[0]:.0f}, mean {best[2]:.0f}, max {best[3]:.0f}")
print("raw (no offset) median |err|",round(float(np.median(np.abs(cerr(A,T)))),0),"; flipped 180",round(float(np.median(np.abs(cerr(A+180,T)))),0))
# signal vs noise
noise=float(np.mean([d["sd"].mean() for d in rows])); sig=np.array([d["mag"] for d in rows])
print(f"\nnoise sd (mean over dirs) {noise:.2f} uT; signal |r| min/median/max {sig.min():.1f}/{np.median(sig):.1f}/{sig.max():.1f} uT; SNR median {np.median(sig)/noise:.0f}")
M=np.array([d["mean"] for d in rows])
adj=[float(np.linalg.norm(M[i]-M[(i+1)%len(M)])) for i in range(len(M))]
print("adjacent 15deg neighbour distance uT: min/median/max",round(min(adj),1),round(float(np.median(adj)),1),round(max(adj),1)," -> d' (distance/noise) median",round(float(np.median(adj))/noise,1))
# nearest-prototype confusion using per-frame vectors against all 24 mean vectors (optimistic: prototype includes the same recording)
conf=np.zeros((len(rows),len(rows)),int)
for i,d in enumerate(rows):
    for v in d["res"]:
        j=int(np.argmin(np.linalg.norm(M-v,axis=1))); conf[i,j]+=1
acc=np.trace(conf)/conf.sum(); off=[min(abs(cerr(T[i],T[j])) for _ in [0]) for i in range(len(rows)) for j in range(len(rows)) for _ in range(conf[i,j]) if i!=j]
print(f"frame-level nearest-prototype accuracy (optimistic, same-recording prototypes) {acc*100:.0f}%; wrong picks median error {np.median(off) if off else 0:.0f} deg")
# split-half (frames 0..n/2 -> prototype, n/2.. -> test) for honest within-recording consistency
ok=0;tot=0
P=np.array([d["res"][:d["n"]//2].mean(0) for d in rows])
for i,d in enumerate(rows):
    for v in d["res"][d["n"]//2:]:
        ok+= int(np.argmin(np.linalg.norm(P-v,axis=1))==i); tot+=1
print(f"split-half accuracy {ok/tot*100:.0f}% (same recording, back half vs front half)")
# 3D vs in-plane: how much of residual is out of plane
print("mean out-of-plane fraction |z|/|r|",round(float(np.mean([abs(d['mean'][2])/d['mag'] for d in rows])),2))
# plots
plt.style.use("dark_background")
fig,ax=plt.subplots(1,3,figsize=(18,6))
a=ax[0]; a.set_aspect("equal"); lim=max(abs(M[:,:2]).max(),1)*1.15
for d in rows:
    t=math.radians(d["target"]); tx,ty=math.sin(t),math.cos(t)
    a.plot([0,tx*lim*0.92],[0,ty*lim*0.92],color="#333",lw=.8)
    a.annotate("",xy=(d["mean"][0],d["mean"][1]),xytext=(0,0),arrowprops=dict(arrowstyle="->",color="w",lw=1.2))
    a.text(tx*lim,ty*lim,f"{d['target']:.0f}",ha="center",va="center",fontsize=7,color="#aaa")
a.set_xlim(-lim*1.1,lim*1.1);a.set_ylim(-lim*1.1,lim*1.1);a.set_title("residual vector in screen plane (uT)\nrays = where the magnet was; arrows = what the sensor saw\n(up = top of screen, right = right)",fontsize=9)
a.grid(color="#222")
a=ax[1]; a.plot(T,[cerr(x,0)%360 for x in A],"o",color="w",label="measured in-plane angle"); a.plot([0,345],[0,345],color="#555",lw=1,label="ideal")
a.set_xlabel("target direction (deg)");a.set_ylabel("measured in-plane angle (deg)");a.legend(fontsize=8);a.set_title("angle: measured vs target",fontsize=9);a.grid(color="#222")
a=ax[2]; w=5; x=np.array(T)
a.bar(x-w,[d["mean"][0] for d in rows],w,label="x (right)",color="#ddd");a.bar(x,[d["mean"][1] for d in rows],w,label="y (up)",color="#888");a.bar(x+w,[d["mean"][2] for d in rows],w,label="z (out of screen)",color="#444")
a.errorbar(x,[0]*len(rows),yerr=[d["sd"].mean() for d in rows],fmt="none",ecolor="r");a.legend(fontsize=8);a.set_xlabel("target direction (deg)");a.set_ylabel("uT");a.set_title("components per direction (red = noise sd)",fontsize=9);a.grid(color="#222")
plt.tight_layout(); plt.savefig(OUT,dpi=130); print("saved",OUT)
