import json, glob, os, collections
import sys
S=os.path.join(os.path.dirname(os.path.abspath(__file__)), *(sys.argv[1:2]))
pyt=dict(l.rstrip('\n').split('\t',1) for l in open(f'{S}/pytania.tsv',encoding='utf-8'))
out=[]; suma=collections.Counter()
for f in sorted(glob.glob(f'{S}/wyniki/*.jsonl')):
    w,q=os.path.basename(f)[:-6].split('-',1)
    calls=[]; wynik=None; bledy=0
    for l in open(f,encoding='utf-8'):
        try: m=json.loads(l)
        except: continue
        if m.get('type')=='assistant':
            for c in m['message']['content']:
                if c['type']=='tool_use': calls.append(f"{c['name'].replace('mcp__sejm__','')}({json.dumps(c['input'],ensure_ascii=False)})")
        if m.get('type')=='user':
            for c in m['message'].get('content',[]):
                if isinstance(c,dict) and c.get('type')=='tool_result' and c.get('is_error'): bledy+=1
        if m.get('type')=='result': wynik=m
    koszt=(wynik or {}).get('total_cost_usd',0); suma[w]+=koszt
    out.append(f"### {w} {q}: {pyt[q]}\nwywołań: {len(calls)}, błędów narzędzi: {bledy}, tur: {(wynik or {}).get('num_turns')}, koszt: ${koszt:.3f}, czas: {((wynik or {}).get('duration_ms') or 0)/1000:.0f}s\n" +
               '\n'.join('  - '+c for c in calls) + f"\nODPOWIEDŹ:\n{(wynik or {}).get('result','(brak wyniku)')}\n")
open(f'{S}/raport.md','w',encoding='utf-8').write('\n'.join(out))
print(len(out),'przebiegów', {k:round(v,2) for k,v in suma.items()})
