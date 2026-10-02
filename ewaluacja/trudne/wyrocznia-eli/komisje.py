"""Bieżące prezydium komisji: członkowie bez leaveDate/mandateExpired, funkcje bez dismissalDate."""
from api import get
import sys
def prezydium(code):
    out = []
    for m in get(f'/sejm/term10/committees/{code}/members'):
        if m.get('leaveDate') or m.get('mandateExpired'): continue
        for f in m.get('functions', []):
            if f.get('dismissalDate'): continue
            if f.get('functionType') != 'member':
                out.append((f['functionType'], f['name'], m['firstName'], m['lastName'], m['id'], f.get('appointmentDate')))
    return sorted(out)
def aktualni(code):
    return [m for m in get(f'/sejm/term10/committees/{code}/members') if not (m.get('leaveDate') or m.get('mandateExpired'))]
if __name__ == '__main__':
    for c in sys.argv[1:]:
        print('==', c, 'aktualnych członków:', len(aktualni(c)))
        for r in prezydium(c): print('  ', r)
