"""Projekty z /sejm/term10/bills filtrowane lokalnie (API ignoruje sort i applicantType)."""
from api import get
B = get('/sejm/term10/bills?limit=5000')
def wybierz(typ, od, do):
    return sorted([b for b in B if b['applicantType'] == typ and od <= b['dateOfReceipt'] <= do], key=lambda b: b['dateOfReceipt'])
if __name__ == '__main__':
    print('PREZYDENT 2026-01-01..2026-06-30')
    for b in wybierz('PRESIDENT', '2026-01-01', '2026-06-30'): print(' ', b['dateOfReceipt'], b['number'], b.get('print'), b['title'])
    print('OBYWATELE 2024-01-01..2025-12-31')
    for b in wybierz('CITIZENS', '2024-01-01', '2025-12-31'): print(' ', b['dateOfReceipt'], b['number'], b.get('print'), b['title'])
    print('OBYWATELSKIE w konsultacjach 2026-09-24')
    for b in B:
        if b['applicantType'] == 'CITIZENS' and b.get('publicConsultationStartDate', '9') <= '2026-09-24' <= b.get('publicConsultationEndDate', '0'):
            print(' ', b['number'], b['title'], b['publicConsultationStartDate'], b['publicConsultationEndDate'])
    print('WSZYSTKIE w konsultacjach 2026-09-24:', sum(1 for b in B if b.get('publicConsultationStartDate', '9') <= '2026-09-24' <= b.get('publicConsultationEndDate', '0')))
