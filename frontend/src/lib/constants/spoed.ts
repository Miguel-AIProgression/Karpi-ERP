// Spoed-toeslag constanten — analoog aan shipping.ts.
// Het werkelijke bedrag komt uit `app_config.productie_planning.spoed_toeslag_bedrag`
// (geleverd door de check-levertijd edge function); deze waarde is een fallback
// voor de UI wanneer de toeslag uit de response onbekend is.

export const SPOED_PRODUCT_ID = 'SPOEDTOESLAG'
export const SPOED_FALLBACK_BEDRAG = 50
