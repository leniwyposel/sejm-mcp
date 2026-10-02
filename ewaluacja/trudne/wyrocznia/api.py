"""Minimal cached client for api.sejm.gov.pl (independent oracle).
Cache: wyrocznia/cache/<sanitised-path>.json ; counter of live requests in cache/_count.txt.
Set SEJM_NOCACHE=1 to force re-fetch."""
import json, os, re, time, urllib.request, urllib.error, urllib.parse
BASE = "https://api.sejm.gov.pl/sejm/"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
os.makedirs(CACHE, exist_ok=True)
CNT = os.path.join(CACHE, "_count.txt")

def _key(path):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", path)[:200] + ".json"

def url(path):
    return BASE + path.lstrip("/")

def get(path, text=False):
    fn = os.path.join(CACHE, _key(path) + (".txt" if text else ""))
    if os.path.exists(fn) and not os.environ.get("SEJM_NOCACHE"):
        with open(fn, encoding="utf-8") as f:
            d = f.read()
        return d if text else json.loads(d)
    req = urllib.request.Request(url(path), headers={"User-Agent": "sejm-mcp-eval", "Accept": "*/*"})
    n = int(open(CNT).read()) if os.path.exists(CNT) else 0
    open(CNT, "w").write(str(n + 1))
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            body = r.read().decode("utf-8")
            status = r.status
    except urllib.error.HTTPError as e:
        body = json.dumps({"__http_error__": e.code})
        status = e.code
        text = False
    time.sleep(0.15)
    with open(fn, "w", encoding="utf-8") as f:
        f.write(body)
    return body if text else json.loads(body)

def count():
    return int(open(CNT).read()) if os.path.exists(CNT) else 0
