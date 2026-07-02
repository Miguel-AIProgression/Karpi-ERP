// Mig 486/ADR-0039 (code-review-fix): de "wij leveren pas zodra..."-paragraaf
// voor Combi-levering leefde als twee losse, byte-identieke kopieën in
// stuur-orderbevestiging/index.ts (e-mail) en _shared/orderbevestiging-pdf.ts
// (PDF) — een schending van ADR-0033 ("Nieuwe gedeelde logica wordt nooit
// gekopieerd"). Beide renderers importeren nu deze ene bron.

import type { Taal } from './klant-taal.ts'

export const COMBI_LEVERING_UITLEG: Record<Taal, string> = {
  nl: 'We combineren uw bestelling graag met eventuele andere openstaande orders naar hetzelfde adres. Zo betaalt u geen verzendkosten zodra het totaal boven onze grens voor gratis verzending komt. Is die grens rond de genoemde leverdatum nog niet gehaald, dan schuift de levering automatisch iets op. Liever niet wachten? Bestel dan gerust nog wat extra, of neem contact met ons op: dan verzenden we deze order graag alsnog apart, tegen verzendkosten.',
  de: 'Wir kombinieren Ihre Bestellung gerne mit weiteren offenen Aufträgen an dieselbe Adresse. So zahlen Sie keine Versandkosten, sobald der Gesamtbetrag unsere Grenze für kostenlosen Versand erreicht. Ist diese Grenze rund um den genannten Liefertermin noch nicht erreicht, verschiebt sich die Lieferung automatisch etwas. Möchten Sie lieber nicht warten? Bestellen Sie gerne noch etwas dazu, oder kontaktieren Sie uns: Dann versenden wir diesen Auftrag gerne separat, gegen Versandkosten.',
  fr: 'Nous combinons volontiers votre commande avec d\'éventuelles autres commandes en cours vers la même adresse. Ainsi, vous ne payez pas de frais de port dès que le montant total atteint notre seuil de livraison gratuite. Si ce seuil n\'est pas encore atteint autour de la date de livraison indiquée, la livraison est automatiquement reportée de peu. Vous préférez ne pas attendre ? Commandez alors un peu plus, ou contactez-nous : nous expédierons volontiers cette commande séparément, avec frais de port.',
  en: 'We\'re happy to combine your order with any other open orders to the same address, so you don\'t pay shipping costs once the total reaches our free-shipping threshold. If that threshold isn\'t met around the stated delivery date, the delivery will shift slightly. Would you rather not wait? Feel free to order a bit more, or get in touch with us: we\'ll gladly ship this order separately instead, with shipping costs.',
}
