import json,math,numpy as np
exec(open("fit.py").read().split("idx=np.arange(24)")[0])
T=np.arange(24)*15.0
def cerr(a,b): return (a-b+180)%360-180
def posterior(F,x,rel=0.2,floor=3.0,kfree=False):
    # F: 24x3 fingerprints; x: Nx3 live residuals -> Nx24 posterior
    sig=rel*np.linalg.norm(F,axis=1)+floor
    out=np.zeros((len(x),24))
    for n,v in enumerate(x):
        best=None
        if not kfree: ks=[1.0]
        else: ks=np.exp(np.linspace(math.log(.5),math.log(2.0),9))
        ll=np.full(24,-1e9)
        for k in ks:
            d2=((v[None,:]-k*F)**2).sum(1); l=-d2/(2*(k*sig)**2)-3*np.log(k*sig)-0.5*(math.log(k)/0.4)**2
            ll=np.maximum(ll,l)
        ll-=ll.max(); w=np.exp(ll); out[n]=w/w.sum()
    return out
def decode(w):
    a=np.radians(T); c=(w*np.cos(a)).sum(1); s=(w*np.sin(a)).sum(1); return np.degrees(np.arctan2(s,c))%360,np.hypot(c,s)
for kfree in (False,True):
  for rel,floor in ((0.2,3.0),(0.3,3.0),(0.15,2.0)):
    allE=[];allC=[];rows=[]
    for tr,te in (("p1","p2"),("p2","p1")):
        for i in range(24):
            fr=passes[te][i][::2]
            w=posterior(MEAN[tr],fr,rel,floor,kfree); a,c=decode(w)
            e=np.abs(cerr(a,T[i])); allE+=list(e); allC+=list(c); rows+=[i]*len(e)
    allE=np.array(allE);allC=np.array(allC);rows=np.array(rows)
    reg={n:(rows>=lo)&(rows<=hi) for n,lo,hi in (("0-135",0,9),("150-225",10,15),("240-345",16,23))}
    s=f"kfree={kfree} rel={rel} floor={floor}: median {np.median(allE):.1f}, <=15deg {np.mean(allE<=15)*100:.0f}%, <=30deg {np.mean(allE<=30)*100:.0f}%, <=45 {np.mean(allE<=45)*100:.0f}% | "
    s+=" ".join(f"{n}: med {np.median(allE[m]):.0f} <=30 {np.mean(allE[m]<=30)*100:.0f}% conc {np.median(allC[m]):.2f}" for n,m in reg.items())
    print(s)
    if rel==0.2 and not kfree:
        for lo,hi in ((0,.5),(.5,.8),(.8,1.01)):
            m=(allC>=lo)&(allC<hi); print(f"   conc {lo}-{hi}: n={m.sum()} median err {np.median(allE[m]) if m.sum() else 0:.0f}  <=30: {np.mean(allE[m]<=30)*100 if m.sum() else 0:.0f}%")
