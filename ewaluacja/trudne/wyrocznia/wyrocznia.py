#!/usr/bin/env python3
"""Niezależna wyrocznia dla ewaluacja/trudne (t001-t060).

Liczy każdą odpowiedź wzorcową prosto z surowego API Sejmu (api.sejm.gov.pl/sejm),
bez kodu sejm-mcp. Odpowiedzi są keszowane w wyrocznia/cache/ ; aby pobrać świeże
dane: SEJM_NOCACHE=1 python3 wyrocznia.py  (ok. 150 zapytań).

Uruchomienie: python3 wyrocznia.py [t001 t016 ...]   (bez argumentów: wszystkie)
"""
import collections
import datetime as dt
import html
import json
import re
import sys

import api

DZIS = dt.date(2026, 9, 24)
ODP = {}


def q(tid):
    def deco(f):
        ODP[tid] = f
        return f
    return deco


def V(term, s, n):
    return api.get(f"term{term}/votings/{s}/{n}")


def lista(term, s):
    return api.get(f"term{term}/votings/{s}")


def glos(d, mp_id):
    for v in d["votes"]:
        if v["MP"] == mp_id:
            return {"club": v["club"], "vote": v["vote"], "listVotes": v.get("listVotes")}
    return None  # posła nie ma na liście głosujących


def split(d):
    c = collections.defaultdict(collections.Counter)
    for v in d["votes"]:
        c[v["club"]][v["vote"]] += 1
    return {k: dict(v) for k, v in sorted(c.items())}


def wynik(d):
    keys = ("yes", "no", "abstain", "present", "notParticipating", "totalVoted",
            "majorityType", "majorityVotes", "votingOptions", "againstAll")
    r = {k: d.get(k) for k in keys if d.get(k) is not None}
    r["date"] = d["date"]
    r["title"] = d["title"]
    r["topic"] = d.get("topic")
    return r


def czy_przyjeto(d):
    """Reguła: kworum (y=n=a=0, present>0) nie jest decyzją; większość zwykła: yes>no;
    pozostałe: yes >= majorityVotes (majorityVotes podaje próg z API)."""
    if d["kind"] == "ON_LIST":
        return "ON_LIST: wybrani = opcje z votes >= majorityVotes"
    if d["yes"] + d["no"] + d["abstain"] == 0 and d.get("present", 0) > 0:
        return "KWORUM - brak rozstrzygnięcia"
    if d["majorityType"] == "SIMPLE_MAJORITY":
        return "przyjęto" if d["yes"] > d["no"] else "odrzucono"
    return "przyjęto" if d["yes"] >= d["majorityVotes"] else "odrzucono"


def mp(mid):
    return api.get(f"term10/MP/{mid}")


def transcripts(sitting, day):
    return api.get(f"term10/proceedings/{sitting}/{day}/transcripts")["statements"]


def tekst(sitting, day, num, n=600):
    t = api.get(f"term10/proceedings/{sitting}/{day}/transcripts/{num}", text=True)
    s = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"\s+", " ", s)[:n]


def D(s):
    return dt.date.fromisoformat(s[:10])


# ---------------- WIELOETAPOWE ----------------
@q("t001")
def _():
    d = V(10, 65, 10)
    return {"Morawiecki(246)": glos(d, 246), "wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t002")
def _():
    d = V(10, 65, 99)
    nieob = {k: v.get("ABSENT", 0) for k, v in split(d).items()}
    return {"nieobecni_wg_klubu": dict(sorted(nieob.items(), key=lambda x: -x[1])),
            "split": split(d), "wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t003")
def _():
    st = [s for s in transcripts(65, "2026-09-18") if s.get("rapporteur")]
    return {"sprawozdawcy_18IX": [(s["num"], s["name"], s["memberID"]) for s in st],
            "tekst_45": tekst(65, "2026-09-18", 45, 400),
            "Różyński(314)_65/99": glos(V(10, 65, 99), 314),
            "klub_dzis": [m["club"] for m in api.get("term10/MP") if m["id"] == 314]}


@q("t004")
def _():
    return {"tekst_16IX_5": tekst(65, "2026-09-16", 5, 450),
            "Horała(134)_65/115": glos(V(10, 65, 115), 134), "wynik_65/115": wynik(V(10, 65, 115)),
            "rozstrzygniecie": czy_przyjeto(V(10, 65, 115))}


@q("t005")
def _():
    p = api.get("term10/processes/2110")
    out = []

    def walk(st, d=0):
        for s in st:
            out.append((d, s.get("date"), s.get("stageName"), s.get("decision"), s.get("printNumber"),
                        {k: s["voting"].get(k) for k in ("sitting", "votingNumber", "yes", "no", "abstain")}
                        if s.get("voting") else None))
            walk(s.get("children", []), d + 1)
    walk(p["stages"])
    return {"passed": p.get("passed"), "etapy": out, "58/62": wynik(V(10, 58, 62)), "65/10": wynik(V(10, 65, 10)),
            "51/72": wynik(V(10, 51, 72))}


@q("t006")
def _():
    d = V(10, 65, 22)
    return {"wynik": wynik(d), "Horała(134)": glos(d, 134)}


@q("t007")
def _():
    st = [s for s in transcripts(65, "2026-09-18") if s.get("rapporteur") and s["num"] == 44]
    d = V(10, 65, 82)
    return {"sprawozdawca": st, "tekst": tekst(65, "2026-09-18", 44, 350), "Kierzek-Koperska(161)": glos(d, 161),
            "KO": split(d)["KO"], "wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t008")
def _():
    lit = mp(215)
    mps = api.get("term10/MP")
    po = sorted([(m["oathDate"], m["id"], m["firstLastName"], m["club"]) for m in mps
                 if m["districtNum"] == 32 and m["oathDate"] > lit["mandateExpiryDate"]])
    return {"Litewka": {k: lit[k] for k in ("mandateExpiryDate", "inactiveCause", "districtNum", "club")},
            "nowi_w_okregu_32_po_wygasnieciu": po, "Borowiec(499)_65/10": glos(V(10, 65, 10), 499)}


@q("t009")
def _():
    d = V(10, 65, 12)
    konf = [(v["firstName"], v["lastName"], v["vote"]) for v in d["votes"]
            if v["club"] == "Konfederacja" and v["vote"] != "YES"]
    return {"Konfederacja": split(d)["Konfederacja"], "nie_za": konf, "wynik": wynik(d),
            "rozstrzygniecie": czy_przyjeto(d)}


@q("t010")
def _():
    d = V(10, 64, 14)
    return {"wynik": wynik(d), "Szymon Hołownia(133)": glos(d, 133)}


@q("t011")
def _():
    L = api.get("term10/interpellations?from=286&limit=500")
    x = [i for i in L if i["num"] == 5561][0]
    sent = D(x["recipientDetails"][0]["sent"])
    rep = [r for r in x["replies"] if not r["prolongation"]][0]
    return {"tytul": x["title"], "adresat": x["recipientDetails"], "odpowiedz_od": rep["from"],
            "data_odp": rep["receiptDate"], "termin": str(sent + dt.timedelta(21)),
            "dni_po_terminie": (D(rep["receiptDate"]) - (sent + dt.timedelta(21))).days,
            "dni_od_przeslania": (D(rep["receiptDate"]) - sent).days}


@q("t012")
def _():
    st = [s for s in transcripts(65, "2026-09-18") if s["num"] == 35]
    return {"sprawozdawca": st, "tekst": tekst(65, "2026-09-18", 35, 300),
            "klub_1/27(2023-11-28)": glos(V(10, 1, 27), 264), "klub_65/68": glos(V(10, 65, 68), 264),
            "klub_dzis": [m["club"] for m in api.get("term10/MP") if m["id"] == 264],
            "wynik_65/68": wynik(V(10, 65, 68))}


@q("t013")
def _():
    st = [(s["num"], s.get("startDateTime"), s.get("unspoken")) for s in transcripts(65, "2026-09-16")
          if s.get("memberID") == 470]
    d = V(10, 65, 86)
    return {"wystapienia_16IX": st, "tekst": tekst(65, "2026-09-16", 90, 330), "glos_65/86": glos(d, 470),
            "wynik": wynik(d)}


@q("t014")
def _():
    out = []
    for day in ("2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"):
        for s in transcripts(65, day):
            if s.get("memberID") == 246:
                out.append((day, s["num"], s.get("startDateTime"), tekst(65, day, s["num"], 420)))
    return {"Morawiecki_65": out}


@q("t015")
def _():
    d = V(10, 65, 82)
    return {"split": split(d), "Morawiecki(246)": glos(d, 246)}


# ---------------- PUŁAPKI REGUŁ ----------------
@q("t016")
def _():
    d = V(10, 65, 3)
    return {"wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t017")
def _():
    d = V(10, 54, 22)
    return {"wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t018")
def _():
    d = V(10, 65, 11)
    return {"wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t019")
def _():
    d = V(10, 59, 51)
    return {"wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t020")
def _():
    d = V(10, 1, 27)
    return {"wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t021")
def _():
    d = V(10, 46, 75)
    return {"wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d)}


@q("t022")
def _():
    d = V(10, 1, 13)
    wyb = [o for o in d["votingOptions"] if o["votes"] >= d["majorityVotes"]]
    return {"wynik": wynik(d), "wybrani": wyb}


@q("t023")
def _():
    return {"65/10": glos(V(10, 65, 10), 343), "dzis": [m["club"] for m in api.get("term10/MP") if m["id"] == 343]}


@q("t024")
def _():
    return {"1/27": glos(V(10, 1, 27), 286), "dzis": [m["club"] for m in api.get("term10/MP") if m["id"] == 286]}


@q("t025")
def _():
    d = V(10, 16, 12)
    return {"Budka_mandat": mp(38)["mandateExpiryDate"], "Budka_w_liscie": glos(d, 38), "wynik": wynik(d)}


@q("t026")
def _():
    L = api.get("term10/interpellations?limit=500&offset=1000&sort_by=-num")
    x = [i for i in L if i["num"] == 18544][0]
    sent = D(x["recipientDetails"][0]["sent"])
    return {"tytul": x["title"], "from": x["from"], "adresat": x["recipientDetails"],
            "replies": [(r["receiptDate"], r["prolongation"], r["from"]) for r in x["replies"]],
            "termin": str(sent + dt.timedelta(21)), "dni_po_terminie_24IX": (DZIS - sent - dt.timedelta(21)).days,
            "sejm_answerDelayedDays": x["answerDelayedDays"]}


@q("t027")
def _():
    L = api.get("term10/interpellations?from=445&limit=500")
    x = [i for i in L if i["num"] == 12176][0]
    return {"tytul": x["title"], "from": x["from"], "adresaci": x["recipientDetails"],
            "replies": [(r["receiptDate"], r["prolongation"], r["from"]) for r in x["replies"]]}


# ---------------- AGREGACJE ----------------
@q("t028")
def _():
    v = lista(10, 65)
    cal = [x for x in v if x["topic"].strip().lower().startswith("głosowanie nad całością projektu")]
    przyj = [x for x in cal if czy_przyjeto(x) == "przyjęto"]
    odrz = [(x["votingNumber"], x["yes"], x["no"], x["abstain"], x["title"][:90]) for x in cal
            if czy_przyjeto(x) != "przyjęto"]
    ustawy = [x["votingNumber"] for x in cal if re.search(r"projek\w* ustaw", x["title"])]
    return {"wszystkie": len(v), "calosc": len(cal), "przyjete": len(przyj), "odrzucone": odrz,
            "calosc_ustaw": len(ustawy), "calosc_uchwal_i_innych": len(cal) - len(ustawy), "ustawy_nr": ustawy,
            "calosc_numery": [x["votingNumber"] for x in cal]}


@q("t029")
def _():
    d = V(10, 65, 12)
    p = [(v["firstName"], v["lastName"], v["vote"]) for v in d["votes"] if v["club"] == "Polska2050"
         and v["vote"] != "YES"]
    return {"Polska2050": split(d)["Polska2050"], "nie_za": p}


@q("t030")
def _():
    L = api.get("term10/interpellations?from=286&limit=500")
    rows = []
    for x in sorted(L, key=lambda x: x["num"]):
        sent = D(x["recipientDetails"][0]["sent"])
        real = sorted(r["receiptDate"] for r in x.get("replies", []) if not r["prolongation"])
        first = D(real[0]) if real else None
        late = ((first or DZIS) - (sent + dt.timedelta(21))).days
        rows.append((x["num"], len(x["from"]), str(sent), real[:1], max(late, 0),
                     [r["receiptDate"] for r in x.get("replies", []) if r["prolongation"]]))
    return {"liczba": len(L), "jako_jedyny_autor": sum(1 for r in rows if r[1] == 1),
            "po_terminie": [r for r in rows if r[4] > 0], "bez_odpowiedzi": [r for r in rows if not r[3]],
            "wszystkie": rows}


def stats(mid):
    s = api.get(f"term10/MP/{mid}/votings/stats")
    return {"dni": len(s), "numMissed": sum(x["numMissed"] for x in s),
            "numVotings": sum(x["numVotings"] for x in s),
            "dni_z_opuszczonym": sum(1 for x in s if x["numMissed"] > 0),
            "dni_usprawiedliwione(absenceExcuse=true)": sum(1 for x in s if x.get("absenceExcuse")),
            "dni_z_opuszczonym_nieuspr": sum(1 for x in s if x["numMissed"] > 0 and not x.get("absenceExcuse")),
            "ostatni_dzien": s[-1]["date"]}


@q("t031")
def _():
    return stats(148)


@q("t032")
def _():
    return stats(343)


@q("t033")
def _():
    v = lista(10, 64)
    c = collections.Counter(x["majorityType"] for x in v)
    t35 = [(x["votingNumber"], x["yes"], x["no"], x["majorityVotes"], czy_przyjeto(x), x["title"][:80]) for x in v
           if x["majorityType"] == "MAJORITY_THREE_FIFTHS"]
    return {"wszystkie": len(v), "typy": dict(c), "3/5": t35}


@q("t034")
def _():
    v = lista(10, 65)
    return {"kworum": [(x["votingNumber"], x["date"], x["present"], x["notParticipating"]) for x in v
                       if x["yes"] + x["no"] + x["abstain"] == 0 and x["present"] > 0]}


@q("t035")
def _():
    mps = api.get("term10/MP")
    cl = [c for c in api.get("term10/clubs") if c["id"] == "Razem"][0]
    return {"membersCount": cl["membersCount"], "nazwa": cl["name"],
            "czlonkowie": [m["firstLastName"] for m in mps if m["club"] == "Razem" and m["active"]]}


@q("t036")
def _():
    L = api.get("term10/interpellations?from=445&limit=500")
    multi = [x["num"] for x in L if len(x["recipientDetails"]) > 1]
    return {"liczba": len(L), "jako_jedyna_autorka": sum(1 for x in L if x["from"] == ["445"]),
            "wielu_adresatow": len(multi), "numery": sorted(multi)}


@q("t037")
def _():
    d = V(10, 64, 15)
    return {"wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d), "split": split(d)}


# ---------------- STARSZE KADENCJE ----------------
@q("t038")
def _():
    return wynik(V(8, 1, 1))


@q("t039")
def _():
    d = V(8, 6, 68)
    return {"wynik": wynik(d), "Kukiz": [v for v in d["votes"] if v["lastName"] == "Kukiz"],
            "Kukiz15": split(d)["Kukiz15"]}


@q("t040")
def _():
    d = V(9, 36, 121)
    return {"wynik": wynik(d), "osoby": [(v["firstName"], v["lastName"], v["club"], v["vote"]) for v in d["votes"]
                                         if v["lastName"] in ("Gowin", "Kukiz")]}


@q("t041")
def _():
    d = V(7, 1, 2)
    return {"wynik": wynik(d), "Tusk": [v for v in d["votes"] if v["lastName"] == "Tusk"]}


@q("t042")
def _():
    return wynik(V(9, 1, 1))


@q("t043")
def _():
    d = V(9, 2, 151)
    return {"wynik": wynik(d), "Gowin": [v for v in d["votes"] if v["lastName"] == "Gowin"]}


@q("t044")
def _():
    return [(c["id"], c["name"], c["membersCount"]) for c in api.get("term7/clubs")]


@q("t045")
def _():
    return [wynik(x) for x in lista(8, 1) if x["votingNumber"] == 4]


# ---------------- DWUZNACZNE ----------------
@q("t046")
def _():
    mps = [m for m in api.get("term10/MP") if m["lastName"] == "Hołownia"]
    d = V(10, 65, 12)
    return {"posłowie": [(m["id"], m["firstLastName"], m["club"]) for m in mps],
            "glosy": {m["firstLastName"]: glos(d, m["id"]) for m in mps}, "wynik": wynik(d)}


@q("t047")
def _():
    mps = [m for m in api.get("term10/MP") if m["lastName"] == "Król"]
    d = V(10, 65, 12)
    return {"posłowie": [(m["id"], m["firstLastName"], m["club"]) for m in mps],
            "glosy": {m["firstLastName"]: glos(d, m["id"]) for m in mps}}


@q("t048")
def _():
    p = api.get("term10/proceedings")
    wczoraj = "2026-09-23"
    return {"posiedzenie_23IX": [x["number"] for x in p if wczoraj in x["dates"]],
            "ostatnie_przed": [(x["number"], x["dates"]) for x in p if x["number"] > 0 and x["dates"][-1] < wczoraj][-1],
            "nastepne": [(x["number"], x["dates"], x.get("current")) for x in p if x["dates"][0] > wczoraj][:1]}


@q("t049")
def _():
    p = api.get("term10/proceedings")
    ost = [x for x in p if x["number"] > 0 and x["dates"][-1] <= str(DZIS)][-1]
    v = lista(10, ost["number"])
    return {"posiedzenie": ost["number"], "dni": ost["dates"], "glosowan": len(v),
            "wg_dnia": dict(collections.Counter(x["date"][:10] for x in v))}


@q("t050")
def _():
    d = V(10, 50, 104)
    return {"wynik": wynik(d), "rozstrzygniecie": czy_przyjeto(d), "Konfederacja": split(d)["Konfederacja"],
            "inna_nowela_KRS_9/15": wynik(V(10, 9, 15))}


@q("t051")
def _():
    d = V(10, 16, 12)
    return {"wynik": wynik(d), "PiS": split(d)["PiS"], "split": split(d)}


@q("t052")
def _():
    return {"65/10": glos(V(10, 65, 10), 128), "dzis": [m["club"] for m in api.get("term10/MP") if m["id"] == 128]}


@q("t053")
def _():
    d = V(10, 62, 110)
    return {"wynik": wynik(d), "Filip(147)": glos(d, 147), "Jarosław(148)": glos(d, 148)}


# ---------------- ODMOWA / KWALIFIKACJA ----------------
@q("t054")
def _():
    return {"aktywnych_poslow": sum(1 for m in api.get("term10/MP") if m["active"]),
            "uwaga": "brak endpointu rankingowego; wymaga ~460 wywołań /MP/{id}/votings/stats"}


@q("t055")
def _():
    m = api.get("term10/MP")[0]
    return {"pola_MP": sorted(m.keys()), "brak_pola_plec": "gender" not in m and "sex" not in m}


@q("t056")
def _():
    return stats(148)


@q("t057")
def _():
    return {"1/999": api.get("term10/votings/1/999"), "max_nr_na_1": max(x["votingNumber"] for x in lista(10, 1))}


@q("t058")
def _():
    p = [x for x in api.get("term10/proceedings") if x["number"] == 66]
    return {"66": p, "glosowania_66": api.get("term10/votings/66")}


@q("t059")
def _():
    out = {}
    for day in ("2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"):
        out[day] = [s["num"] for s in transcripts(65, day) if s.get("memberID") == 148]
    return out


@q("t060")
def _():
    top = api.get("term10/interpellations?limit=500&sort_by=-num")[0]["num"]
    return {"99999": api.get("term10/interpellations/99999"), "najwyzszy_numer_24IX": top}


if __name__ == "__main__":
    ids = sys.argv[1:] or sorted(ODP)
    for tid in ids:
        print(f"=== {tid}")
        print(json.dumps(ODP[tid](), ensure_ascii=False, indent=1, default=str))
    print("live requests so far (licznik):", api.count(), file=sys.stderr)
