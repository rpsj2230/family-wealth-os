import sys, re, datetime as dt, openpyxl, collections
p=sys.argv[1]
ws=openpyxl.load_workbook(p,data_only=True)['Oct 2026']
TODAY=dt.datetime(2026,10,25)
rows=[]; owner=None; inst=None
for r in range(3,108):
    a=ws.cell(r,1).value
    if a: 
        inst=a.split('\n')[0].strip()
    b=ws.cell(r,2).value
    if b is None and ws.cell(r,6).value is None: continue
    rows.append(dict(r=r,inst=inst,B=b,C=ws.cell(r,3).value,D=ws.cell(r,4).value,E=ws.cell(r,5).value,F=ws.cell(r,6).value,G=ws.cell(r,7).value,H=ws.cell(r,8).value,N=ws.cell(r,14).value))
def kind(x):
    E=x['E']
    if isinstance(E,dt.datetime): return 'FD'
    if isinstance(E,str):
        if E.startswith('Cash-NR') : return 'CASH_'+E[-3:]
        if E=='Cash SG': return 'CASH_SG'
        if E=='Cash Loan': return 'LOAN'
        if E.startswith('SIP'): return 'MF'
        if E in('Shares','Options & Future'): return 'STOCK'
        if E=='FD': return 'FD_CLOSED'
    return 'OTHER'
agg=collections.defaultdict(float); cnt=collections.Counter()
for x in rows:
    x['k']=kind(x); agg[x['k']]+=x['F'] or 0; cnt[x['k']]+=1
print("== by kind (sheet col F) ==")
for k,v in agg.items(): print(f"{k:10s} n={cnt[k]:3d} {v:>14,.2f}")
print("sum F rows 3-107:",f"{sum(agg.values()):,.2f}")
# FDs
fds=[x for x in rows if x['k']=='FD']
print("\n== FDs ==",len(fds),"principal",f"{sum(x['F'] for x in fds):,}","maturity value",f"{sum(x['G'] for x in fds):,}")
def qc(P,rate,d0,d1):
    days=(d1-d0).days; return P*(1+rate/4)**(days/365*4)
print("-- quarterly-compounding check (sheet maturity vs model), diff>0.3% flagged --")
for x in fds:
    m=qc(x['F'],x['C'],x['D'],x['E']); d=(x['G']-m)/x['G']
    flag='  <<' if abs(d)>0.003 else ''
    print(f"r{x['r']:3d} {x['inst'][:18]:18s} {x['B'][:16]:16s} P={x['F']:>9,} {x['C']:.4f} {x['D']:%d%b%y}->{x['E']:%d%b%y} sheet={x['G']:>9,} model={m:>11,.0f} {d*100:+.2f}%{flag}")
print("\n-- matured on/before today but still listed --")
for x in fds:
    if x['E']<=TODAY: print(f"r{x['r']} {x['inst']} {x['B']} {x['F']:,} matured {x['E']:%d %b %Y}")
print("-- maturing within 90 days --")
for x in sorted(fds,key=lambda x:x['E']):
    d=(x['E']-TODAY).days
    if 0<d<=90: print(f"{d:3d}d {x['E']:%d %b %Y} {x['inst']} {x['B']} P={x['F']:,} mat={x['G']:,}")
# by institution
print("\n-- FD principal by institution/holder --")
byi=collections.defaultdict(float)
for x in fds: byi[x['inst']]+=x['F']
for k,v in sorted(byi.items(),key=lambda t:-t[1]): print(f"{k:22s}{v:>12,.0f}")
print("total principal",f"{sum(byi.values()):,.0f}")
# by owner (name after dash)
bo=collections.defaultdict(float)
for x in fds: bo[x['inst'].split('-')[-1].strip()]+=x['F']
print(dict(bo))
# cash
print("\n-- cash by type/institution --")
for x in rows:
    if x['k'].startswith('CASH') and (x['F'] or 0)>1000: print(x['k'],x['inst'],x['B'],f"{x['F']:,}")
# MF
print("\n-- MF by section --")
sec=collections.defaultdict(lambda:[0,0,0])
for x in rows:
    if x['k']=='MF':
        s=sec[(x['inst'][:30],x['E'])]; s[0]+=x['F']; s[1]+=x['H'] or 0; s[2]+=1
for k,v in sec.items(): print(k,f"value={v[0]:,.0f} invested={v[1]:,.0f} n={v[2]}")
act=[x for x in rows if x['k']=='MF' and 'STOPPED' not in x['B']]
stp=[x for x in rows if x['k']=='MF' and 'STOPPED' in x['B']]
print("active funds",len(act),f"{sum(x['F'] for x in act):,}", "stopped",len(stp),f"{sum(x['F'] for x in stp):,}")
tv=sum(x['F'] for x in rows if x['k']=='MF'); ti=sum(x['H'] or 0 for x in rows if x['k']=='MF')
print(f"MF total value {tv:,} invested {ti:,} P&L {tv-ti:,}")
sip=[re.search(r'(\d+)K/Month',x['N'] or '') for x in act]
print("monthly SIP sum from notes (K):",sum(int(m.group(1)) for m in sip if m))
# SGD
for x in rows:
    if x['k']=='CASH_SG': print(x['B'],x['F'],x['N'])
print("\n-- E column value types --",collections.Counter(type(x['E']).__name__ for x in rows))
print("C col non-rate:",[ (x['r'],x['C']) for x in rows if x['C'] is not None and not isinstance(x['C'],float)])
# formulas inventory
wf=openpyxl.load_workbook(p)['Oct 2026']
pat=collections.Counter()
for row in wf.iter_rows():
    for c in row:
        if isinstance(c.value,str) and c.value.startswith('='):
            pat[re.sub(r'\d+','#',c.value)]+=1
print("\nformula patterns:",dict(pat))
