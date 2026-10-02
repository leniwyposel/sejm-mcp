"""Kodeksy: najnowszy akt zmieniający (wg roku/pozycji) i najnowszy tekst jednolity + czy ma HTML."""
from api import get
import json
KOD = {"Kodeks pracy":"DU/1974/141","Kodeks cywilny":"DU/1964/93","Kodeks karny":"DU/1997/553","KPA":"DU/1960/168"}
def k(i): t,y,p=i.split('/'); return (int(y),int(p))
for n,a in KOD.items():
    d=get('/eli/acts/'+a); r=d['references']
    print('==',n,a,d['title'],d['status'],d['inForce'],d.get('textHTML'))
    zm=sorted(r.get('Akty zmieniające',[]),key=lambda x:k(x['id']))
    print(' zmieniające (ostatnie 3 wg pozycji):',zm[-3:], 'liczba',len(zm))
    tj=sorted(r.get('Inf. o tekście jednolitym',[]),key=lambda x:k(x['id']))
    print(' teksty jednolite ostatnie:',tj[-2:])
    for x in zm[-2:]+tj[-1:]:
        e=get('/eli/acts/'+x['id'])
        print('   ',x['id'],e['title'][:150],'| prom',e.get('promulgation'),'| wejście',e.get('entryIntoForce'),'| HTML',e.get('textHTML'),'PDF',e.get('textPDF'),'|',e.get('status'),e.get('inForce'))
