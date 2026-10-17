import json,math,numpy as np
from scipy.optimize import least_squares
data=json.load(open("/tmp/train_raw_all.json")); sess={}
for v in data.values(): sess.setdefault(v["session"],{})[v["step"]]=v
def rot(q,v,inv=False):
    x,y,z,w=q
    if inv:x,y,z=-x,-y,-z
    vx,vy,vz=v;tx=2*(y*vz-z*vy);ty=2*(z*vx-x*vz);tz=2*(x*vy-y*vx)
    return np.array([vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)])
def load(sid):
    S=sess[sid]; b0=np.mean([rot(f[2],f[1]) for f in S[0]["frames"]],axis=0); out=[]
    for s in range(1,25):
        r=np.array([np.array(f[1])-rot(f[2],b0,True) for f in S[s]["frames"]]); out.append(r)
    return out
R=2.9
P=np.array([(R*math.sin(math.radians((s)*15)),R*math.cos(math.radians(s*15))) for s in range(24)])
passes={"p1":load("smvcsno5y"),"p2":load("pass2")}
MEAN={k:np.array([r.mean(0) for r in v]) for k,v in passes.items()}
def model(par,pos,h=0.0):
    sx,sy,sz,mx,my,mz=par
    rv=np.stack([sx-pos[:,0],sy-pos[:,1],np.full(len(pos),-sz-h)],1)  # sensor minus magnet; sensor sits sz below the glass plane
    d=np.linalg.norm(rv,axis=1,keepdims=True); rh=rv/d; m=np.array([mx,my,mz])
    return (3*(rh@m)[:,None]*rh-m)/d**3
def fit(Ms,idx):
    best=None
    for sx0 in (-3,0,3):
      for sy0 in (0,3,6):
        for sz0 in (0.5,1.5):
          for sgn in (1,-1):
            x0=[sx0,sy0,sz0,0,0,sgn*3000]
            f=lambda p:np.concatenate([((model(p,P[idx])-M[idx])/(np.linalg.norm(M[idx],axis=1,keepdims=True)+8)).ravel() for M in Ms])
            r=least_squares(f,x0,loss="soft_l1",f_scale=0.3,max_nfev=400)
            if best is None or r.cost<best.cost: best=r
    return best
idx=np.arange(24)
for name,Ms in (("p1",[MEAN["p1"]]),("p2",[MEAN["p2"]]),("both",[MEAN["p1"],MEAN["p2"]])):
    b=fit(Ms,idx); print(name,"params sx,sy,sz,mx,my,mz",b.x.round(2),"cost",round(b.cost,3))
    pr=model(b.x,P)
    for k in ("p1","p2"):
        rel=np.linalg.norm(pr-MEAN[k],axis=1)/(np.linalg.norm(MEAN[k],axis=1)+8)
        print("   rel err vs",k,"median",round(float(np.median(rel)),2),"p90",round(float(np.percentile(rel,90)),2))
    np.save(f"/tmp/par_{name}.npy",b.x)
