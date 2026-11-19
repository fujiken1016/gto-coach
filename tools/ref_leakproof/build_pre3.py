# nodes.json の3ノードを PRE 形式（{"ハンド":[レイズ%,コール%]}）へ変換する。verify_pre_vs_public.py と同じ規則を共有する。
import json,os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,os.path.join(HERE,'..'))
import gto_ref as g
NODES={'CO-vs-open-MP':34,'BTN-vs-4bet-MP':47,'CO-vs-4bet-MP':51}
EXPECT={34:('CO','HJ raise 2bb'),47:('BTN','HJ raise 2bb, BTN raise 6bb, HJ raise 16bb'),51:('CO','HJ raise 2bb, CO raise 6bb, HJ raise 16bb')}
def load():
  d=json.load(open(os.path.join(HERE,'nodes.json')))
  for i,(a,l) in EXPECT.items():
    assert d[i]['actor']==a and d[i]['line']==l,(i,d[i]['actor'],d[i]['line'])
  return d
def convert(node):
  out={}
  for h in g.HANDS:
    c=node['classes'].get(h)
    if not c: continue
    r=c_=0.0
    for a,v in zip(node['actions'],c['strategy']):
      if a=='call': c_+=v
      elif a!='fold': r+=v
    r,c_=round(r*100),round(c_*100)
    if r==0 and c_==0: continue
    out[h]=[r,c_]
  return out
def build():
  d=load()
  return {k:convert(d[i]) for k,i in NODES.items()}
if __name__=='__main__':
  print(json.dumps(build(),ensure_ascii=False,separators=(',',':')))
