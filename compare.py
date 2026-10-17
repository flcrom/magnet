import json,math,sys,urllib.request
import numpy as np
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
room=sys.argv[1] if len(sys.argv)>1 else "PIXEL6A"; A_id=sys.argv[2] if len(sys.argv)>2 else "smvcsno5y"; B_id=sys.argv[3] if len(sys.argv)>3 else "pass2"
data=json.load(urllib.request.urlopen(urllib.request.Request(f"https://magnet.flcrom.dev/rec?room={room}",headers={"User-Agent":"Mozilla/5.0"})))
json.dump(data,open("/tmp/train_raw_all.json","w"))
sess={}
for k,v in data.items(): sess.setdefault(v["session"],{})[v["step"]]=v
def rot(q,v,inv=False):
    x,y,z,w=q
    if inv:x,y,z=-x,-y,-z
    vx,vy,vz=v;tx=2*(y*vz-z*vy);ty=2*(z*vx-x*vz);tz=2*(x*vy-y*vx)
    return np.array([vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)])
def load(sid):
    S=sess[sid]; b0=np.mean([rot(f[2],f[1]) for f in S[0]["frames"]],axis=0)
    out={}
    for s in range(1,25):
        if s not in S: continue
        res=np.array([np.array(f[1])-rot(f[2],b0,True) for f in S[s]["frames"]]); out[s]=res
    far=None
    if 25 in S: far=np.mean([rot(f[2],f[1]) for f in S[25]["frames"]],axis=0)-b0
    return out,b0,far,len(S)
A,bA,fA,nA=load(A_id); B,bB,fB,nB=load(B_id)
print(f"pass1 {A_id}: {nA} recs  pass2 {B_id}: {nB} recs; baseline |B| {np.linalg.norm(bA):.1f} vs {np.linalg.norm(bB):.1f}; far-check drift {np.linalg.norm(fA) if fA is not None else float('nan'):.2f} vs {np.linalg.norm(fB) if fB is not None else float('nan'):.2f} uT")
common=[s for s in range(1,25) if s in A and s in B]
mA={s:A[s].mean(0) for s in common}; mB={s:B[s].mean(0) for s in common}
noise=float(np.mean([A[s].std(0).mean() for s in common]+[B[s].std(0).mean() for s in common]))
print(f"\nwithin-recording noise sd {noise:.2f} uT")
print("step deg   pass1 (x,y,z)            pass2 (x,y,z)          diff uT  diff/|p1| ")
diff={}
for s in common:
    d=float(np.linalg.norm(mA[s]-mB[s])); diff[s]=d
    print(f"{s:>3} {(s-1)*15:>4}  {mA[s].round(1)}  {mB[s].round(1)}  {d:>7.1f}  {d/max(np.linalg.norm(mA[s]),1e-6):>6.2f}")
dv=np.array([diff[s] for s in common]); rel=np.array([diff[s]/np.linalg.norm(mA[s]) for s in common])
print(f"\ndiff pass2-pass1: median {np.median(dv):.1f} uT (about {np.median(dv)/noise:.0f}x the within-recording noise), max {dv.max():.1f}; relative median {np.median(rel)*100:.0f}% of the signal")
# nearest pass-1 fingerprint for each pass-2 recording (means) and per frame
ks=common; P=np.array([mA[s] for s in ks])
def cerr(i,j): return int(((i-j+12)%24)-12)
conf=np.zeros((24,24),int); frame_conf=np.zeros((24,24),int); errs=[]
for s in ks:
    j=ks[int(np.argmin(np.linalg.norm(P-mB[s],axis=1)))]; conf[s-1,j-1]+=1; errs.append(cerr(s-1,j-1))
    for v in B[s]:
        jj=ks[int(np.argmin(np.linalg.norm(P-v,axis=1)))]; frame_conf[s-1,jj-1]+=1
errs=np.array(errs)
print(f"\npass-2 recording matched to pass-1 fingerprints: exact {np.mean(errs==0)*100:.0f}%, within 1 step (15 deg) {np.mean(abs(errs)<=1)*100:.0f}%, within 2 steps {np.mean(abs(errs)<=2)*100:.0f}%, median |error| {np.median(abs(errs))*15:.0f} deg")
print("per-direction (deg: matched-as offset in steps):",{(s-1)*15:int(e) for s,e in zip(ks,errs)})
fa=np.trace(frame_conf)/frame_conf.sum(); print(f"frame-level exact accuracy {fa*100:.0f}%")
# also a log-signed matching (relative shape) to be robust to magnitude differences
def f(v): return np.sign(v)*np.log1p(abs(v))
PL=np.array([f(mA[s]) for s in ks]); e2=[]
for s in ks:
    j=ks[int(np.argmin(np.linalg.norm(PL-f(mB[s]),axis=1)))]; e2.append(cerr(s-1,j-1))
e2=np.array(e2); print(f"same, using log-scaled vectors: exact {np.mean(e2==0)*100:.0f}%, within 1 step {np.mean(abs(e2)<=1)*100:.0f}%, within 2 steps {np.mean(abs(e2)<=2)*100:.0f}%")
for lo,hi,name in ((1,10,"0-135 deg"),(11,16,"150-225 deg (bottom)"),(17,24,"240-345 deg")):
    sel=[i for i,s in enumerate(ks) if lo<=s<=hi]
    if sel: print(f"  region {name}: exact {np.mean(errs[sel]==0)*100:.0f}%, within 1 step {np.mean(abs(errs[sel])<=1)*100:.0f}%, median diff {np.median(dv[sel]):.1f} uT")
plt.style.use("dark_background"); fig,ax=plt.subplots(1,3,figsize=(18,6))
a=ax[0]; X=np.concatenate([[mA[s][k],mB[s][k]] for s in ks for k in range(3)]).reshape(-1,2); g=lambda v:np.sign(v)*np.log1p(abs(v))
for k,c,l in ((0,"#fff","x"),(1,"#999","y"),(2,"#555","z")):
    a.scatter([g(mA[s][k]) for s in ks],[g(mB[s][k]) for s in ks],c=c,label=l,s=22)
lim=7; a.plot([-lim,lim],[-lim,lim],color="#666");a.set_xlabel("pass 1 (signed log uT)");a.set_ylabel("pass 2");a.legend();a.set_title("same position, two passes: components",fontsize=9);a.grid(color="#222")
a=ax[1]; a.bar([(s-1)*15 for s in ks],dv,width=10,color="#ddd",label="|pass2-pass1|");a.bar([(s-1)*15 for s in ks],[np.linalg.norm(mA[s]) for s in ks],width=4,color="#666",label="|pass1|");a.set_yscale("log")
a.axhline(noise,color="r");a.set_xlabel("target direction (deg)");a.set_ylabel("uT (log)");a.legend(fontsize=8);a.set_title("difference between passes vs signal (red = noise)",fontsize=9);a.grid(color="#222")
a=ax[2]; im=a.imshow(conf,cmap="gray");a.set_xlabel("matched pass-1 direction index");a.set_ylabel("true direction index (pass 2)");a.set_title("confusion: pass-2 recording -> nearest pass-1 fingerprint\n(each step 15 deg; diagonal = correct)",fontsize=9)
plt.tight_layout();plt.savefig("/downloads/magnet-repeat.png",dpi=130);print("saved /downloads/magnet-repeat.png")
