"""W których komisjach (bieżąco) zasiada poseł i z jaką funkcją: skan /committees/{code}/members wszystkich komisji."""
from api import get
import sys
def komisje_posla(mp_id):
    out = []
    for c in get('/sejm/term10/committees'):
        for m in get(f"/sejm/term10/committees/{c['code']}/members"):
            if m['id'] != mp_id or m.get('leaveDate') or m.get('mandateExpired'): continue
            fun = [f['name'] for f in m.get('functions', []) if not f.get('dismissalDate')]
            out.append((c['code'], c['name'], fun))
    return out
if __name__ == '__main__':
    for i in sys.argv[1:]:
        print('== MP', i)
        for r in komisje_posla(int(i)): print('  ', r)
