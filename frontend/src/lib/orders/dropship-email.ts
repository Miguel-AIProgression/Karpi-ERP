// Pure helpers voor de dropshipment e-mail-regel (geen React, geen Supabase).
//
// Bij een dropshipment-order levert Karpi rechtstreeks aan de consument
// namens de debiteur (winkel). Het aflever-e-mailadres (orders.afl_email —
// track & trace richting de vervoerder, mig 365) moet dan het adres van de
// CONSUMENT zijn en wijkt per definitie af van het factuur-/debiteur-adres
// (mail Marjon, Sales Support, 11-06-2026). SQL-spiegel: is_dropship_order +
// dropship-guard in fn_zending_fill_email (mig 370).

export type DropshipEmailProbleem =
  | 'ontbreekt'           // geen afl_email → consument krijgt geen track & trace
  | 'gelijk_aan_factuur'  // afl_email = factuur-e-mailadres van de order
  | 'gelijk_aan_debiteur' // afl_email = e-mailadres van de debiteur (winkel)

function norm(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * Toetst het aflever-e-mailadres van een dropshipment-order.
 * Retourneert null als het adres in orde is. Alleen aanroepen wanneer de
 * order daadwerkelijk dropshipment is (`heeftDropshipRegel`, flag-based).
 */
export function dropshipAflEmailProbleem(opts: {
  aflEmail: string | null | undefined
  factEmail: string | null | undefined
  debiteurEmails?: (string | null | undefined)[]
}): DropshipEmailProbleem | null {
  const afl = norm(opts.aflEmail)
  if (!afl) return 'ontbreekt'
  if (afl === norm(opts.factEmail)) return 'gelijk_aan_factuur'
  if ((opts.debiteurEmails ?? []).some((e) => norm(e) === afl)) {
    return 'gelijk_aan_debiteur'
  }
  return null
}

/** 'ontbreekt' is een waarschuwing (geen T&T = toegestaan); de rest blokkeert opslaan. */
export function isBlokkerendDropshipEmailProbleem(
  probleem: DropshipEmailProbleem | null,
): probleem is 'gelijk_aan_factuur' | 'gelijk_aan_debiteur' {
  return probleem === 'gelijk_aan_factuur' || probleem === 'gelijk_aan_debiteur'
}

export const DROPSHIP_EMAIL_MELDING: Record<DropshipEmailProbleem, string> = {
  ontbreekt:
    'Dropshipment: vul het e-mailadres van de consument in — anders ontvangt die geen track & trace.',
  gelijk_aan_factuur:
    'Dropshipment: dit is het factuur-e-mailadres. Track & trace moet naar de consument, niet naar de winkel.',
  gelijk_aan_debiteur:
    'Dropshipment: dit is het e-mailadres van de klant (winkel). Track & trace moet naar de consument.',
}
