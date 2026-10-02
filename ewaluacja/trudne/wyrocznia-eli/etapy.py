"""Etapy procesu legislacyjnego (spłaszczone) z /sejm/term10/processes/{nr}."""
from api import get
import sys
def flat(st, depth=0, out=None):
    out = [] if out is None else out
    for s in st or []:
        out.append((depth, s.get('date'), s.get('stageName'), s.get('stageType'), s.get('decision') or s.get('comment') or ''))
        flat(s.get('children'), depth+1, out)
    return out
def proces(nr):
    return get(f'/sejm/term10/processes/{nr}')
if __name__ == '__main__':
    for nr in sys.argv[1:]:
        p = proces(nr); print('###', nr, p.get('title','')[:120], '| ELI', p.get('ELI'), '| passed', p.get('passed'))
        for d, date, n, t, x in flat(p.get('stages')):
            if d == 0: print('   ', date, n, '|', t, '|', str(x)[:80])
