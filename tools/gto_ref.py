import re,json,sys
R="AKQJT98765432"
HANDS=[]
for i in range(13):
  for j in range(13):
    HANDS.append(R[i]+R[j] if i==j else (R[i]+R[j]+"s" if i<j else R[j]+R[i]+"o"))
def parse_ts(path):
  s=open(path).read()
  out={}
  for m in re.finditer(r"^  '([A-Z]+-[A-Za-z0-9-]+)':\s*\{(.*?)^  \},",s,re.S|re.M):
    key,body=m.group(1),m.group(2)
    body=re.sub(r"//[^\n]*","",body)
    cells={}
    for h,v in re.findall(r"'([AKQJT2-9]{2}[so]?)':\s*('[a-z]+'|\[[^\]]*\])",body):
      acts=re.findall(r"'([a-z]+)'",v)
      fr={'r':0,'c':0,'f':0}
      share=100/len(acts) if len(set(acts))>1 else 100
      if len(set(acts))==1: acts=acts[:1]
      for a in acts:
        k={'raise':'r','allin':'r','call':'c','fold':'f'}[a]
        fr[k]+=share
      if h in cells: raise SystemExit(f"dup {key} {h}")
      cells[h]=fr
    if "weight" in body: raise SystemExit("weighted cell in "+key)
    out[key]=cells
  return out
def ref_tables(srcdir):
  g=parse_ts(srcdir+"/greenline.ts"); p=parse_ts(srcdir+"/pekarstas.ts")
  return g,p
def to_pre(cells):
  d={}
  for h in HANDS:
    fr=cells.get(h)
    if not fr: continue
    r,c=round(fr['r']),round(fr['c'])
    if r==0 and c==0: continue
    d[h]=[r,c]
  return d
def main_act(r,c):
  f=max(0,100-r-c); m=max(r,c,f)
  return frozenset(a for a,v in (('r',r),('c',c),('f',f)) if v==m)
