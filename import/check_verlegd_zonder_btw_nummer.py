"""Overzicht voor sales: actieve verlegd-debiteuren zonder btw-nummer.

BTW verleggen (intracommunautair, mig 371) vereist formeel een geldig
btw-nummer van de afnemer. Dit script print de actieve debiteuren met
btw_verlegd_intracom=TRUE waar dat nummer ontbreekt, zodat sales ze kan
aanvullen op de Info-tab van de klant.

Draaien vanuit de hoofd-tree (import/.env aanwezig): python check_verlegd_zonder_btw_nummer.py
"""
from config import SUPABASE_URL, SUPABASE_KEY
from supabase import create_client


def main() -> None:
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    rows = (
        sb.table('debiteuren')
        .select('debiteur_nr,naam,land,btw_nummer,status')
        .eq('btw_verlegd_intracom', True)
        .or_('status.is.null,status.neq.Inactief')  # actief = niet expliciet Inactief
        .execute()
        .data
    )
    zonder = [r for r in rows if not (r.get('btw_nummer') or '').strip()]
    print(f"Actieve verlegd-debiteuren zonder btw-nummer: {len(zonder)}")
    print(f"{'nr':>8}  {'land':<16} naam")
    for r in sorted(zonder, key=lambda r: ((r.get('land') or ''), r['debiteur_nr'])):
        print(f"{r['debiteur_nr']:>8}  {(r.get('land') or ''):<16} {r['naam']}")


if __name__ == '__main__':
    main()
