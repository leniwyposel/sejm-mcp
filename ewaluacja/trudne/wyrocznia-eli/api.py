"""Wspólny klient wyroczni: GET z nagłówkiem sejm-mcp-eval, pamięć podręczna na dysku, licznik żądań."""
import hashlib, json, os, sys, time, urllib.request, urllib.error
BASE = "https://api.sejm.gov.pl"
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
CNT = os.path.join(DIR, "_licznik.txt")
os.makedirs(DIR, exist_ok=True)

def _count():
    n = int(open(CNT).read()) if os.path.exists(CNT) else 0
    open(CNT, "w").write(str(n + 1))
    return n + 1

def get(path, raw=False, fresh=False):
    url = path if path.startswith("http") else BASE + path
    key = os.path.join(DIR, hashlib.sha1(url.encode()).hexdigest()[:16])
    if os.path.exists(key) and not fresh:
        data = open(key, "rb").read()
    else:
        req = urllib.request.Request(url, headers={"User-Agent": "sejm-mcp-eval", "Accept": "*/*"})
        n = _count()
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
        except urllib.error.HTTPError as e:
            data = ("__HTTP_%d__" % e.code).encode()
        open(key, "wb").write(data)
        open(key + ".url", "w").write(url)
        time.sleep(0.3)
    if raw:
        return data.decode("utf-8", "replace")
    s = data.decode("utf-8", "replace")
    if s.startswith("__HTTP_"):
        return {"_http": int(s[7:10])}
    return json.loads(s)

def licznik():
    return int(open(CNT).read()) if os.path.exists(CNT) else 0
