"""Wyciąga treść wskazanych artykułów z HTML tekstu jednolitego (div class="unit ..." id="...-arti_N")."""
from api import get
import re, html, sys
def art(act, n):
    h = get(f'/eli/acts/{act}/text.html', raw=True)
    m = re.search(r'<div[^>]*class="unit[^"]*"[^>]*id="([^"]*arti_%s)"' % re.escape(n), h)
    if not m: return None, None
    start = m.start()
    nxt = re.search(r'<div[^>]*class="unit[^"]*unit_arti[^"]*"[^>]*id="[^"]*arti_', h[m.end():])
    seg = h[start: m.end() + (nxt.start() if nxt else 20000)]
    txt = html.unescape(re.sub(r'<[^>]+>', ' ', seg))
    return m.group(1), re.sub(r'\s+', ' ', txt).strip()
if __name__ == '__main__':
    for act, n in [('DU/2023/1465','154'),('DU/2024/17','148'),('DU/2024/1061','118'),('DU/2024/572','35'),('DU/1997/483','127')]:
        i,t = art(act,n); print('##',act,n,i); print((t or '')[:900]); print()
