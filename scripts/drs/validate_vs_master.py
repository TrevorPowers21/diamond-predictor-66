"""
Routine cross-check: diff the pitch-log accruals against the TruMedia Master exports (the SB-count pattern —
pitch log for value, official Master to confirm). Run after regenerating accruals.
  python3 scripts/drs/accrue_hitter_stats.py && python3 scripts/drs/accrue_pitcher_stats.py \
    && python3 scripts/drs/accrue_pitcher_er.py && python3 scripts/drs/validate_vs_master.py
"""
import csv
def load(path, stats):
    M={}
    with open(path,newline="") as fh:
        for r in csv.DictReader(fh):
            pid=(r.get("playerId") or "").strip()
            def g(k):
                try: return float(r.get(k,"") or 0)
                except: return None
            M[pid]={k:g(s) for k,s in stats.items()}
    return M
def diff(A,M,minkey,minval,tol,title):
    rows=[(A[p],M[p]) for p in M if A.get(p) and (M[p].get(minkey) or 0)>=minval]
    print(f"\n{title}  (n={len(rows)}, Master {minkey}>={minval})")
    for f,t in tol.items():
        d=[a[f]-m[f] for a,m in rows if a.get(f) is not None and m.get(f) is not None]
        if not d: continue
        mean=sum(d)/len(d); mabs=sum(abs(x) for x in d)/len(d); w=sum(1 for x in d if abs(x)<=t)
        print(f"  {f:6} meanΔ {mean:+7.3f}  mean|Δ| {mabs:6.3f}  within {t}: {100*w/len(d):3.0f}%")
def loadacc(path,fields):
    A={}
    with open(path,newline="") as fh:
        for r in csv.DictReader(fh):
            def f(k):
                try: return float(r[k])
                except: return None
            A[r["source_player_id"]]={k:f(k) for k in fields}
    return A
HM=load("docs/drs-reference/Full Season Hitting Master Stats.csv",
   {k:k for k in ("AVG","OBP","SLG","PA","AB","H","2B","3B","HR","BB","HBP")})
HA=loadacc("scripts/drs/output/hitter_accrued.csv",("AVG","OBP","SLG","PA","AB","H","2B","3B","HR","BB","HBP"))
diff(HA,HM,"AB",50,{"AVG":.01,"OBP":.01,"SLG":.01,"PA":3,"AB":3,"H":3,"2B":2,"3B":1,"HR":1,"BB":2,"HBP":2},
     "HITTER (accrued vs Full Hitting Master)")
PM=load("docs/drs-reference/Full Season Pitching Master Stats.csv",
   {"IP":"IP","FIP":"FIP","WHIP":"WHIP","K9":"K/9","BB9":"BB/9","HR9":"HR/9","K":"K","BB":"BB","HR":"HR","H":"H","BF":"BF"})
PAc=loadacc("scripts/drs/output/pitcher_accrued.csv",("IP","FIP","WHIP","K9","BB9","HR9","K","BB","HR","H","BF"))
diff(PAc,PM,"IP",20,{"IP":3,"FIP":.25,"WHIP":.1,"K9":.5,"BB9":.5,"HR9":.3,"K":3,"BB":3,"HR":2,"H":4,"BF":5},
     "PITCHER clean line (accrued vs Full Pitching Master)")
PMe=load("docs/drs-reference/Full Season Pitching Master Stats.csv",{"ERA":"ERA","ER":"ER"})
PAe=loadacc("scripts/drs/output/pitcher_er.csv",("ERA","ER"))
# add IP filter from PM
for p in PMe: PMe[p]["IP"]=PM.get(p,{}).get("IP")
diff(PAe,PMe,"IP",20,{"ERA":.5,"ER":3},"PITCHER ERA (score-driven, vs Full Pitching Master)")
