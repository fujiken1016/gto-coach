import re,json,sys,os
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
import gto_ref as g
html=sys.argv[1] if len(sys.argv)>1 else os.path.join(HERE,'..','index.html')
s=open(html).read()
PRE=json.loads(re.search(r'const PRE=(\{.*?\});\n',s,re.S).group(1))
m=re.search(r'const PRE_OFF = new Set\((\[.*?\])\)',s)
OFF=set(json.loads(m.group(1))) if m else set()
G,P=g.ref_tables(os.path.join(HERE,'ref_poker_charts'))
ALL=json.load(open(os.path.join(HERE,'ref_poker_charts','keys55.json')))
sys.path.insert(0,os.path.join(HERE,'ref_leakproof'))
import build_pre3
LP=build_pre3.build()  # Leakproof 6max-100bb-norake 1.0.0（CC BY 4.0）から変換した3キー
tot=mis=0; rows=[]; nosrc=[]
for k in ALL:
  ref=G.get(k) or P.get(k); src='greenline' if k in G else ('pekarstas' if k in P else None)
  if not src and k in LP:
    # 3キーはLeakproofと全セル値まで完全一致（r,c とも）を要求する
    n=x=0
    for h in g.HANDS:
      n+=1
      if PRE.get(k,{}).get(h,[0,0])!=LP[k].get(h,[0,0]): x+=1
    tot+=n; mis+=x; rows.append((k,'leakproof','live' if k in PRE and k not in OFF else 'NOT LIVE',x,n)); continue
  if not src: nosrc.append((k, 'OFF' if k in OFF else ('LIVE' if k in PRE else 'absent'))); continue
  if k in OFF or k not in PRE: rows.append((k,src,'NOT LIVE',0,0)); continue
  n=x=0
  for h in g.HANDS:
    e=PRE[k].get(h,[0,0]); fr=ref.get(h,{'r':0,'c':0,'f':0})
    n+=1
    if g.main_act(e[0],e[1])!=g.main_act(round(fr['r']),round(fr['c'])): x+=1
  tot+=n; mis+=x; rows.append((k,src,'live',x,n))
for r in rows: print(*r)
print("no-source keys:",nosrc)
live_nosrc=[k for k,st in nosrc if st=='LIVE']
print(f"TOTAL cells={tot} mismatch={mis} rate={mis/tot*100:.1f}%  live keys without source={len(live_nosrc)}")
sys.exit(1 if mis or live_nosrc else 0)
