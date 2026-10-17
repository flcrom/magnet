import json,math,numpy as np
exec(open("fit.py").read().split("idx=np.arange(24)")[0])
T=np.arange(24)*15.0
def feat(v,kind):
    v=np.atleast_2d(v)
    if kind=="raw": return v
    if kind=="unit": return v/(np.linalg.norm(v,axis=1,keepdims=True)+1e-9)
    if kind=="log": return np.sign(v)*np.log1p(abs(v))
    if kind=="logunit": f=np.sign(v)*np.log1p(abs(v)); return f/(np.linalg.norm(f,axis=1,keepdims=True)+1e-9)
def cerr(a,b): return (a-b+180)%360-180
def post(train,x,kind,sig):
    F=feat(train,kind); fx=feat(x,kind)
    d2=((F[None,:,:]-fx[:,None,:])**2).sum(2)
    ll=-d2/(2*sig**2); ll-=ll.max(1,keepdims=True); w=np.exp(ll); return w/w.sum(1,keepdims=True)
def decode(w):
    a=np.radians(T); c=(w*np.cos(a)).sum(1); s=(w*np.sin(a)).sum(1)
    return np.degrees(np.arctan2(s,c))%360, np.hypot(c,s)
for kind,sig in (("raw",None),("unit",0.25),("log",None),("logunit",0.25)):
  for tr,te in (("p1","p2"),("p2","p1")):
    errs=[];conc=[];exact=0;n=0;byreg={}
    for i in range(24):
        fr=passes[te][i]
        F=feat(MEAN[tr],kind); 
        s_=sig if sig else (0.6 if kind=="log" else 1.0)
        w=post(MEAN[tr],fr,kind,s_)
        ang,c=decode(w); e=np.abs(cerr(ang,T[i])); errs+=list(e); conc+=list(c)
    errs=np.array(errs); 
    reg=lambda lo,hi: np.array([e for i in range(lo,hi) for e in np.abs(cerr(decode(post(MEAN[tr],passes[te][i],kind,sig if sig else (0.6 if kind=="log" else 1.0)))[0],T[i]))])
    print(f"{kind:8s} train {tr} test {te}: median err {np.median(errs):5.1f} deg, within 15: {np.mean(errs<=15)*100:3.0f}%, within 30: {np.mean(errs<=30)*100:3.0f}%, within 45 {np.mean(errs<=45)*100:3.0f}%  | upper(0-135) med {np.median(reg(0,10)):.0f}, bottom(150-225) med {np.median(reg(10,16)):.0f}, left/top(240-345) med {np.median(reg(16,24)):.0f}")
