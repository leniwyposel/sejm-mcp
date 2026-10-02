"""Wyrocznia pytań t061-t100: liczy każdą odpowiedź wzorcową z surowych API Sejmu i ELI.

Uruchom: python3 wyrocznia.py [--swiezo]   (--swiezo pomija pamięć podręczną cache/)
Nie korzysta z kodu sejm-mcp. Nagłówek User-Agent: sejm-mcp-eval (api.py).
"""
import re, html, sys, collections
import api
from api import get
from artykuly import art
from komisje import prezydium, aktualni
from etapy import proces, flat
if '--swiezo' in sys.argv:
    _g = api.get
    api.get = get = (lambda p, raw=False, fresh=True: _g(p, raw=raw, fresh=True))

def akt(a): return get('/eli/acts/' + a)
def k(i): _, y, p = i.split('/'); return (int(y), int(p))
def ostatni(a, rodzaj): return max(akt(a)['references'].get(rodzaj, []), key=lambda x: k(x['id']))['id']
def meta(a, pola=('title','displayAddress','status','inForce','announcementDate','promulgation','entryIntoForce','textHTML','textPDF','legalStatusDate','repealDate','comments')):
    e = akt(a); return {p: e.get(p) for p in pola if e.get(p) is not None}
def etapy_top(nr): return [(d, n, t) for dep, d, n, t, _ in flat(proces(nr).get('stages')) if dep == 0]
def tekst(h): return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', h))).strip()

W = collections.OrderedDict()
def q(f): W[f.__name__] = f; return f

@q
def t061():
    tj = ostatni('DU/1974/141', 'Inf. o tekście jednolitym'); return tj, meta(tj)
@q
def t062():
    tj = ostatni('DU/1964/93', 'Inf. o tekście jednolitym'); return tj, meta(tj)
@q
def t063():
    tj = ostatni('DU/1960/168', 'Inf. o tekście jednolitym'); zm = ostatni('DU/1960/168', 'Akty zmieniające')
    return {'tj': (tj, meta(tj)), 'zmiana': (zm, meta(zm))}
@q
def t064():
    zm = ostatni('DU/1997/553', 'Akty zmieniające'); return zm, meta(zm)
@q
def t065(): return art('DU/2023/1465', '154')[1][:260]
@q
def t066(): return art('DU/2024/1061', '118')[1]
@q
def t067(): return art('DU/2024/572', '35')[1][:900]
@q
def t068(): return art('DU/2024/17', '148')[1][:260]
@q
def t069(): return meta('DU/2026/1046')
@q
def t070():
    d = get('/eli/acts/search?publisher=DU&type=Ustawa&dateEffectFrom=2026-08-01&dateEffectTo=2026-08-31&limit=200')
    it = [i for i in d['items'] if (i.get('entryIntoForce') or '').startswith('2026-08')]
    return len(it), [(i['ELI'], i['entryIntoForce'], i['title']) for i in sorted(it, key=lambda i: i['entryIntoForce']) if i['entryIntoForce'] == '2026-08-11']
@q
def t071():
    return meta('DU/2004/1807'), akt('DU/2004/1807')['references'].get('Akty uchylające'), meta('DU/2018/650', ('title', 'displayAddress'))
@q
def t072():
    from datetime import date
    m = meta('DU/2024/928'); d = (date.fromisoformat(m['entryIntoForce']) - date.fromisoformat(m['promulgation'])).days
    return m, 'dni:', d
@q
def t073():
    s = get('/eli/acts/search?publisher=DU&year=2026&title=likwidacji%20Centralnego%20Biura&limit=100')['totalCount']
    return proces('1884').get('ELI'), etapy_top('1884')[-3:], 'ELI trafień:', s
@q
def t074():
    s = [i['ELI'] for i in get('/eli/acts/search?publisher=DU&year=2026&title=podatku%20akcyzowym&limit=100')['items']]
    return proces('2457').get('ELI'), etapy_top('2457')[-3:], 'ELI 2026 akcyza:', s
@q
def t075():
    p = proces('2443'); return p.get('ELI'), meta(p['ELI']), etapy_top('2443')[-2:]
@q
def t076(): return meta('DU/2023/1465'), ostatni('DU/1974/141', 'Inf. o tekście jednolitym')
@q
def t077():
    tj = akt('DU/1997/553')['references']['Inf. o tekście jednolitym']
    return len(tj), sorted((x['id'] for x in tj), key=k), meta(max(tj, key=lambda x: k(x['id']))['id'], ('title', 'textHTML'))
@q
def t078(): return meta('MP/2023/1261')
@q
def t079(): return prezydium('ZDR')
@q
def t080(): return prezydium('CNT')
@q
def t081():
    from posel_komisje import komisje_posla; return komisje_posla(285)
@q
def t082():
    s = [x for x in get('/sejm/term10/committees/CNT/sittings') if x['date'].startswith('2026-07')]
    return len(s), [(x['num'], x['date'], x.get('status'), [j['code'] for j in x.get('jointWith', [])]) for x in s]
@q
def t083():
    x = [i for i in get('/sejm/term10/committees/CNT/sittings') if i['num'] == 119][0]
    return x['date'], x['startDateTime'], x['room'], tekst(x['agenda'])
@q
def t084():
    p = get('/sejm/term10/proceedings/current'); it = re.findall(r'<li[^>]*>(.*?)</li>', p['agenda'], re.S)
    return p['number'], p['dates'], len(it), tekst(it[0])
@q
def t085():
    return [(m['firstName'], m['lastName'], m['function']) for m in get('/sejm/term10/clubs/Polska2050')['members'] if m.get('function') and not m.get('leaveDate')]
@q
def t086():
    return [(m['name'], m['club'], m['type']) for m in get('/sejm/term10/bilateralGroups/470')['members'] if m['type'] == 'chairman' and not m.get('membershipEnd')]
@q
def t087():
    t = get('/sejm/term'); return len(t), [(x['num'], x['from'], x.get('to')) for x in t if x['num'] in (9, 10)]
@q
def t088():
    from posel_komisje import komisje_posla
    kl = [m.get('function') for m in get('/sejm/term10/clubs/Polska2050')['members'] if m['id'] == 382]
    return komisje_posla(382), kl
@q
def t089():
    from projekty import wybierz; x = wybierz('PRESIDENT', '2026-01-01', '2026-06-30')
    return len(x), [(b['dateOfReceipt'], b['title'][62:]) for b in x]
@q
def t090():
    from projekty import wybierz; x = wybierz('CITIZENS', '2024-01-01', '2025-12-31')
    return len(x), [(b['dateOfReceipt'], b.get('print'), b['title']) for b in x]
@q
def t091():
    from projekty import B
    return [(b['number'], b['title'], b['publicConsultationStartDate'], b['publicConsultationEndDate']) for b in B
            if b['applicantType'] == 'CITIZENS' and b.get('publicConsultationStartDate', '9') <= '2026-09-24' <= b.get('publicConsultationEndDate', '0')]
@q
def t092():
    p = [i for i in get('/sejm/term10/prints?limit=5000') if 'kryptoaktyw' in i['title']]
    n = max(p, key=lambda i: (i['deliveryDate'], i['number'])); return n['number'], n['deliveryDate'], n['title'], n.get('processPrint')
@q
def t093():
    v = [x for x in get('/sejm/term10/videos/2026-09-18') if x['type'] == 'posiedzenie']
    return [(x['title'], x['startDateTime'], x['endDateTime'], x['room'], x['playerLink']) for x in v]
@q
def t094():
    x = [i for i in get('/sejm/term10/committees/CNT/sittings') if i['num'] == 119][0]
    return [(v['playerLink'], v['startDateTime'], v['endDateTime']) for v in x.get('video', [])]
@q
def t095():
    from projekty import B; x = [b for b in B if b['applicantType'] == 'PRESIDENT']
    n = max(x, key=lambda b: b['dateOfReceipt']); return len(x), n['dateOfReceipt'], n['number'], n['title']
@q
def t096(): return meta('DU/1997/483')
@q
def t097(): return [e for e in etapy_top('2443') if e[2] in ('SenatePosition', 'SenatePositionConsideration', 'PresidentSignature')]
@q
def t098(): return get('/eli/acts/search?title=bezdomnych%20kot%C3%B3w&limit=50')['totalCount']
@q
def t099(): return get('/eli/acts/DU')['years'][0], get('/eli/acts/MP')['years'][0], get('/eli/acts/DU/1917')['totalCount']
@q
def t100(): return len(akt('DU/1974/141')['references']['Akty wykonawcze'])

if __name__ == '__main__':
    for n, f in W.items():
        try: print(n, '=>', f())
        except Exception as e: print(n, 'BŁĄD', repr(e))
    print('żądań HTTP łącznie (licznik):', api.licznik())
