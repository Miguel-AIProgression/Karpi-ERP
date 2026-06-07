import { useState, useCallback, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClientSelector, type SelectedClient } from './client-selector'
import { AddressSelector } from './address-selector'
import { InvoiceAddressEditor, type FactuurAdres, type FactuurContact } from './invoice-address-editor'
import { OrderLineEditor } from './order-line-editor'
import { LevertijdSuggestie } from './levertijd-suggestie'
import { LeverModusDialog, type LeverModusTekort } from './lever-modus-dialog'
import { berekenRegelDekking, invalidateNaReserveringsmutatie, type LeverModus } from '@/modules/reserveringen'
import {
  LevertijdFitIndicator,
  SnelsteHaalbaarKnop,
  useNeemSnelsteOver,
} from '@/modules/levertijd'
import { createOrder, updateOrderWithLines, deleteOrder, resolveOrderlinePrice, fetchKlantArtikelnummer, setUitwisselbaarClaims, type LevertijdSnapshotContext } from '@/lib/supabase/queries/order-mutations'
import type { OrderFormData, OrderRegelFormData, PrijsBron, PrijsBreakdown } from '@/lib/supabase/queries/order-mutations'
import { fetchKlanteigenNaam } from '@/modules/debiteuren'
import { supabase } from '@/lib/supabase/client'
import { fetchOrderConfig } from '@/lib/supabase/queries/order-config'
import { triggerAutoplan, fetchAutoplanningConfig } from '@/modules/snijplanning'
import { berekenMaatwerkAfleverdatumViaSeam } from '@/modules/maatwerk'
import {
  verzendWeekIsoString,
  verzendWeekStringToDatum,
  verzendWeekVoor,
  verzendWeekRelatief,
  verzendWeekSleutel,
} from '@/lib/orders/verzendweek'
import { applyShippingLogic } from '@/lib/orders/verzend-regel'
import { bepaalOrderAfleverdatum } from '@/lib/orders/order-afleverdatum'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import { SPOED_PRODUCT_ID, SPOED_FALLBACK_BEDRAG } from '@/lib/constants/spoed'

function getISOWeek(dateStr: string): number {
  return verzendWeekVoor(dateStr)?.week ?? 0
}

interface OrderFormProps {
  mode: 'create' | 'edit'
  initialData?: {
    orderId: number
    client: SelectedClient | null
    header: Partial<OrderFormData>
    regels: OrderRegelFormData[]
    status?: string
  }
  /**
   * Bij `mode='create'` aangeroepen na succesvolle opslag, vóór navigatie.
   * Krijgt alle aangemaakte order-id's (1 bij niet-split, 2 bij split).
   * Geeft de pagina de kans om buffered side-effects (zoals document-uploads)
   * af te ronden.
   */
  onAfterCreate?: (orderIds: number[]) => Promise<void>
}

export function OrderForm({ mode, initialData, onAfterCreate }: OrderFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [client, setClient] = useState<SelectedClient | null>(initialData?.client ?? null)
  const [header, setHeader] = useState<Partial<OrderFormData>>(initialData?.header ?? {})
  const [regels, setRegels] = useState<OrderRegelFormData[]>(initialData?.regels ?? [])
  const [error, setError] = useState<string | null>(null)
  const [deelleveringen, setDeelleveringen] = useState<boolean>(
    initialData?.client?.deelleveringen_toegestaan ?? false
  )
  const [afleverdatumOverridden, setAfleverdatumOverridden] = useState<boolean>(
    () => !!initialData?.header?.afleverdatum
  )
  const [spoedActief, setSpoedActief] = useState<boolean>(
    () => mode === 'edit' && (initialData?.regels ?? []).some(r => r.artikelnr === SPOED_PRODUCT_ID)
  )
  const [leverModusDialogOpen, setLeverModusDialogOpen] = useState(false)
  const [afhalen, setAfhalen] = useState<boolean>(initialData?.header?.afhalen ?? false)

  // In edit-modus laadt clientData asynchroon na de eerste render.
  // Sync de prijslijst en korting zodra die beschikbaar komen.
  useEffect(() => {
    if (mode !== 'edit' || !initialData?.client) return
    const incoming = initialData.client
    setClient((prev) => {
      if (!prev) return incoming
      if (prev.prijslijst_nr === incoming.prijslijst_nr && prev.korting_pct === incoming.korting_pct) return prev
      return { ...prev, prijslijst_nr: incoming.prijslijst_nr, korting_pct: incoming.korting_pct }
    })
  }, [mode, initialData?.client?.prijslijst_nr, initialData?.client?.korting_pct])

  const { data: orderConfig } = useQuery({ queryKey: ['order-config'], queryFn: fetchOrderConfig })

  const afleverdatumInfo = useMemo(
    () => bepaalOrderAfleverdatum(regels, client, orderConfig),
    [regels, client, orderConfig],
  )

  // Levertijd-Module integratie (ADR-0020 stap 6). Bestaande regels met DB-id
  // zijn de scope voor fit-check + snelste-haalbaar: nieuwe regels in een
  // create-form hebben nog geen id, dus de RPC's hebben er niets aan totdat
  // de order opgeslagen is.
  const persistedRegelIds = useMemo(
    () =>
      regels
        .map((r) => r.id)
        .filter((id): id is number => typeof id === 'number'),
    [regels],
  )
  const gewensteWeek = useMemo(
    () => (header.afleverdatum ? verzendWeekSleutel(header.afleverdatum) : ''),
    [header.afleverdatum],
  )
  const neemSnelsteOver = useNeemSnelsteOver()

  // Laatste maatwerk-regel met complete kwaliteit + kleur + afmetingen,
  // gebruikt als input voor de real-time levertijd-check.
  const levertijdInput = useMemo(() => {
    for (let i = regels.length - 1; i >= 0; i--) {
      const r = regels[i]
      if (
        r.is_maatwerk &&
        r.maatwerk_kwaliteit_code &&
        r.maatwerk_kleur_code &&
        r.maatwerk_lengte_cm &&
        r.maatwerk_breedte_cm
      ) {
        return {
          kwaliteitCode: r.maatwerk_kwaliteit_code,
          kleurCode: r.maatwerk_kleur_code,
          lengteCm: r.maatwerk_lengte_cm,
          breedteCm: r.maatwerk_breedte_cm,
          vorm: r.maatwerk_vorm ?? null,
        }
      }
    }
    return null
  }, [regels])

  function applyAfleverdatum(nieuwRegels: OrderRegelFormData[], c: SelectedClient | null) {
    if (afleverdatumOverridden) return
    const info = bepaalOrderAfleverdatum(nieuwRegels, c, orderConfig)
    if (!info.langsteDatum) return
    const week = String(getISOWeek(info.langsteDatum))
    setHeader((h) => ({ ...h, afleverdatum: info.langsteDatum!, week }))
  }

  // In edit mode, if a VERZEND line already exists, preserve it (override=true)
  const [shippingOverridden, setShippingOverridden] = useState(
    () => mode === 'edit' && (initialData?.regels ?? []).some(r => r.artikelnr === SHIPPING_PRODUCT_ID)
  )

  /** Toggle afhalen — verwijdert/herstelt verzend-regel automatisch en zet
   *  shippingOverridden uit zodat de auto-logica weer leidend wordt. */
  function handleAfhalenToggle(nieuw: boolean) {
    setAfhalen(nieuw)
    setShippingOverridden(false)
    setRegels((current) => applyShippingLogic(current, client, nieuw))
  }

  // Auto-fill addresses when client is selected + reprice existing lines
  const handleClientChange = async (c: SelectedClient | null) => {
    setClient(c)
    setShippingOverridden(false)
    setDeelleveringen(c?.deelleveringen_toegestaan ?? false)
    // Klant-default 'Afhalen' moet de afhalen-checkbox vooraf aanvinken —
    // anders moet de operator dezelfde keuze die al op het klantprofiel
    // staat opnieuw maken bij elke order.
    const nieuweAfhalen = c?.afleverwijze === 'Afhalen'
    setAfhalen(nieuweAfhalen)
    if (c) {
      setHeader((h) => ({
        ...h,
        debiteur_nr: c.debiteur_nr,
        vertegenw_code: c.vertegenw_code ?? undefined,
        betaler: c.betaler ?? undefined,
        inkooporganisatie: c.inkooporganisatie ?? undefined,
        fact_naam: c.fact_naam ?? c.naam,
        fact_adres: c.fact_adres ?? c.adres ?? undefined,
        fact_postcode: c.fact_postcode ?? c.postcode ?? undefined,
        fact_plaats: c.fact_plaats ?? c.plaats ?? undefined,
        fact_land: c.land ?? 'NL',
        afl_naam: c.naam,
        afl_adres: c.adres ?? undefined,
        afl_postcode: c.postcode ?? undefined,
        afl_plaats: c.plaats ?? undefined,
        afl_land: c.land ?? 'NL',
        lever_type: h.lever_type ?? c.default_lever_type ?? 'week',
      }))
      applyAfleverdatum(regels, c)

      // Reprice existing order lines for the new customer
      if (regels.length > 0) {
        const nonShippingRegels = regels.filter(l => l.artikelnr !== SHIPPING_PRODUCT_ID)
        const updatedRegels = await Promise.all(
          nonShippingRegels.map(async (line) => {
            if (!line.artikelnr) return line

            // Reprice via fallback-keten (mig 191) — vermijdt
            // dubbele logica met handleArticleSelected.
            let newPrijs = line.prijs
            let newPrijsBron: PrijsBron | undefined = line.prijs_bron
            let newPrijsBreakdown: PrijsBreakdown | undefined = line.prijs_breakdown
            const resolved = await resolveOrderlinePrice(line.artikelnr, c.prijslijst_nr ?? null)
            if (resolved.prijs !== null) {
              newPrijs = resolved.prijs
              newPrijsBron = resolved.bron
              newPrijsBreakdown = resolved.breakdown
            }

            // Lookup klant artikelnummer
            let klant_artikelnr: string | undefined
            const kanResult = await fetchKlantArtikelnummer(c.debiteur_nr, line.artikelnr)
            if (kanResult) klant_artikelnr = kanResult.klant_artikel

            const updated = {
              ...line,
              prijs: newPrijs,
              prijs_bron: newPrijsBron,
              prijs_breakdown: newPrijsBreakdown,
              prijs_uit_prijslijst: newPrijsBron === 'prijslijst_vast',
              korting_pct: c.korting_pct ?? line.korting_pct,
              klant_artikelnr,
            }
            updated.bedrag = (updated.orderaantal ?? 0) * (updated.prijs ?? 0) *
              (1 - (updated.korting_pct ?? 0) / 100)
            updated.bedrag = Math.round(updated.bedrag * 100) / 100
            return updated
          })
        )
        setRegels(applyShippingLogic(updatedRegels, c, nieuweAfhalen))
      }
    }
  }

  const handleAddressSelect = (addr: { naam: string; adres: string; postcode: string; plaats: string; land: string }) => {
    setHeader((h) => ({
      ...h,
      afl_naam: addr.naam,
      afl_adres: addr.adres,
      afl_postcode: addr.postcode,
      afl_plaats: addr.plaats,
      afl_land: addr.land,
    }))
  }

  const handleFactuurAdresChange = (addr: FactuurAdres) => {
    setHeader((h) => ({
      ...h,
      fact_naam: addr.naam,
      fact_adres: addr.adres,
      fact_postcode: addr.postcode,
      fact_plaats: addr.plaats,
      fact_land: addr.land,
    }))
  }

  const handleFactuurAdresSavedAsDefault = (addr: FactuurAdres, contact: FactuurContact) => {
    // Sync de in-memory client zodat een volgende order in dezelfde sessie
    // ook het nieuwe adres + e-mails pakt (en het klant-detailscherm in andere
    // tabs eveneens fris is na de invalidate hieronder).
    setClient((c) => c ? {
      ...c,
      fact_naam: addr.naam,
      fact_adres: addr.adres,
      fact_postcode: addr.postcode,
      fact_plaats: addr.plaats,
      email_factuur: contact.email_factuur || null,
      email_overig: contact.email_overig || null,
    } : c)
    // Klant-detailpagina cachet onder ['klanten', debiteur_nr] én
    // ['klant-factuur-instellingen', debiteur_nr] — beide refreshen.
    if (client?.debiteur_nr) {
      queryClient.invalidateQueries({ queryKey: ['klanten', client.debiteur_nr] })
      queryClient.invalidateQueries({ queryKey: ['klant-factuur-instellingen', client.debiteur_nr] })
      queryClient.invalidateQueries({ queryKey: ['client-commercial', client.debiteur_nr] })
    }
  }

  // Price + customer-specific data lookup when article is added.
  // Sinds mig 191: gebruikt RPC `bereken_orderregel_prijs` met fallback-keten
  // (prijslijst_vast → prijslijst_m2 → maatwerk_artikel_m2 → kwaliteit_m2 →
  // product_verkoopprijs). Voor verzend/spoed niet aanroepen — die hebben
  // hun eigen logica in applyShippingLogic / applySpoedToeslag.
  const handleArticleSelected = useCallback(async (article: { artikelnr: string; kwaliteit_code: string | null; kleur_code?: string | null }) => {
    const debiteurNr = client?.debiteur_nr
    let prijs: number | null = null
    let prijs_bron: PrijsBron = 'geen'
    let prijs_breakdown: PrijsBreakdown = {}
    let klant_eigen_naam: string | null = null
    let klant_artikelnr: string | null = null

    if (article.artikelnr !== SHIPPING_PRODUCT_ID && article.artikelnr !== SPOED_PRODUCT_ID) {
      const resolved = await resolveOrderlinePrice(article.artikelnr, client?.prijslijst_nr ?? null)
      prijs = resolved.prijs
      prijs_bron = resolved.bron
      prijs_breakdown = resolved.breakdown
    }

    if (debiteurNr) {
      // Lookup klanteigen naam (via kwaliteit_code, optioneel verfijnd op kleur)
      if (article.kwaliteit_code) {
        const kenResult = await fetchKlanteigenNaam(debiteurNr, article.kwaliteit_code, article.kleur_code ?? null)
        if (kenResult) klant_eigen_naam = kenResult.benaming
      }

      // Lookup klant artikelnummer
      const kanResult = await fetchKlantArtikelnummer(debiteurNr, article.artikelnr)
      if (kanResult) klant_artikelnr = kanResult.klant_artikel
    }

    return { prijs, prijs_bron, prijs_breakdown, klant_eigen_naam, klant_artikelnr }
  }, [client?.prijslijst_nr, client?.debiteur_nr])

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => deleteOrder(initialData!.orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['pick-ship'] })
      navigate('/orders')
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Verwijderen mislukt')
      setShowDeleteConfirm(false)
    },
  })

  /**
   * Voeg of verwijder een SPOEDTOESLAG-orderregel afhankelijk van actief-state.
   * Zelfde patroon als applyShippingLogic.
   */
  function applySpoedToeslag(currentRegels: OrderRegelFormData[], actief: boolean, bedrag: number): OrderRegelFormData[] {
    const heeft = currentRegels.some(r => r.artikelnr === SPOED_PRODUCT_ID)
    if (actief && !heeft) {
      return [...currentRegels, {
        artikelnr: SPOED_PRODUCT_ID,
        omschrijving: 'Spoedtoeslag',
        orderaantal: 1,
        te_leveren: 1,
        prijs: bedrag,
        korting_pct: 0,
        bedrag,
      }]
    }
    if (!actief && heeft) {
      return currentRegels.filter(r => r.artikelnr !== SPOED_PRODUCT_ID)
    }
    return currentRegels
  }

  /**
   * Trigger auto-plan-groep voor elke unieke (kwaliteit, kleur) van maatwerk-regels.
   * Respecteert auto-planning config; failures zijn niet-blokkerend voor order-aanmaak.
   */
  async function triggerAutoplanForMaatwerk(allRegels: OrderRegelFormData[]) {
    try {
      const cfg = await fetchAutoplanningConfig()
      if (!cfg.enabled) return
      const groepen = new Set<string>()
      for (const r of allRegels) {
        if (r.is_maatwerk && r.maatwerk_kwaliteit_code && r.maatwerk_kleur_code) {
          groepen.add(`${r.maatwerk_kwaliteit_code}|${r.maatwerk_kleur_code}`)
        }
      }
      if (groepen.size === 0) return
      await Promise.allSettled(
        Array.from(groepen).map((key) => {
          const [kwaliteit, kleur] = key.split('|')
          return triggerAutoplan(kwaliteit, kleur)
        }),
      )
    } catch (e) {
      console.warn('Auto-plan trigger faalde (niet-blokkerend):', e)
    }
  }

  /**
   * Persist handmatige uitwisselbaar-keuzes per regel via set_uitwisselbaar_claims-RPC.
   * Matcht op regelnummer (volgorde-index) na fetch van de net opgeslagen regels.
   */
  async function persistUitwisselbaarKeuzes(orderId: number, regelsList: OrderRegelFormData[]) {
    const regelsMetKeuzes = regelsList.filter(r => (r.uitwisselbaar_keuzes ?? []).length > 0)
    if (regelsMetKeuzes.length === 0) return

    const { data: dbRegels } = await supabase
      .from('order_regels')
      .select('id, regelnummer')
      .eq('order_id', orderId)
    const idPerRegelnummer = new Map<number, number>(
      ((dbRegels ?? []) as { id: number; regelnummer: number }[]).map(r => [r.regelnummer, r.id]),
    )

    for (let i = 0; i < regelsList.length; i++) {
      const r = regelsList[i]
      const keuzes = r.uitwisselbaar_keuzes ?? []
      if (keuzes.length === 0) continue
      // Bij create: regelnummer = i + 1 (zie create_order_with_lines payload).
      // Bij edit: regelnummer wordt ook hergenummerd als i + 1 in updateOrderWithLines.
      const dbId = idPerRegelnummer.get(i + 1) ?? r.id
      if (!dbId) continue
      await setUitwisselbaarClaims(
        dbId,
        keuzes.map(k => ({ artikelnr: k.artikelnr, aantal: k.aantal })),
      )
    }
  }

  const saveMutation = useMutation({
    mutationFn: async (overrideLeverModus?: LeverModus) => {
      if (!client) throw new Error('Selecteer een klant')
      if (regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID).length === 0) throw new Error('Voeg minstens één orderregel toe')

      const headerWithModus: Partial<OrderFormData> = overrideLeverModus
        ? { ...header, lever_modus: overrideLeverModus, afhalen }
        : { ...header, afhalen }
      const orderData: OrderFormData = { ...headerWithModus, debiteur_nr: client.debiteur_nr }

      // Levertijd-Module snapshot-context (ADR-0020 / mig 276): geef de klant
      // mee zodat `createOrder` / `updateOrderWithLines` de klant-standaard
      // afleverdatum kunnen bepalen en in `orders.standaard_afleverdatum_berekend`
      // schrijven. Eenmalig bij eerste commit; daarna immutable.
      const snapshotCtx: LevertijdSnapshotContext = { klant: client }

      if (mode === 'create') {
        // Split-order flow: deelleveringen AAN + gemengde order (standaard + maatwerk)
        if (deelleveringen && afleverdatumInfo.heeftGemengd) {
          const shippingRegel = regels.find(r => r.artikelnr === SHIPPING_PRODUCT_ID)
          const standaardRegels = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && !r.is_maatwerk)
          const maatwerkRegels = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && r.is_maatwerk)

          // Issue #33: maatwerk-afleverdatum via echte planning-seam (check-levertijd)
          // i.p.v. de statische maatwerk_weken-config — die laatste levert "1 week
          // later" terwijl de echte capaciteit 15 weken kan zijn.
          const echteMaatwerkDatum = await berekenMaatwerkAfleverdatumViaSeam({
            maatwerkRegels,
            debiteurNr: client.debiteur_nr,
            fallbackDatum: afleverdatumInfo.maatwerkDatum,
            gewensteLeverdatum: header.afleverdatum ?? null,
          })

          const standaardOrder: OrderFormData = {
            ...orderData,
            afleverdatum: afleverdatumInfo.standaardDatum ?? orderData.afleverdatum,
            week: afleverdatumInfo.standaardDatum ? String(getISOWeek(afleverdatumInfo.standaardDatum)) : orderData.week,
          }
          const maatwerkOrder: OrderFormData = {
            ...orderData,
            afleverdatum: echteMaatwerkDatum ?? orderData.afleverdatum,
            week: echteMaatwerkDatum ? String(getISOWeek(echteMaatwerkDatum)) : orderData.week,
          }

          // Issue #33: verzendkosten naar de duurste sub-order (eerder altijd
          // standaard-deel — onlogisch als maatwerk-deel waardevoller is).
          const totaalStandaard = standaardRegels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
          const totaalMaatwerk = maatwerkRegels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
          const verzendNaarMaatwerk = totaalMaatwerk > totaalStandaard
          const regelsA = !verzendNaarMaatwerk && shippingRegel
            ? [...standaardRegels, shippingRegel]
            : standaardRegels
          const regelsB = verzendNaarMaatwerk && shippingRegel
            ? [...maatwerkRegels, shippingRegel]
            : maatwerkRegels

          const a = await createOrder(standaardOrder, regelsA, snapshotCtx)
          const b = await createOrder(maatwerkOrder, regelsB, snapshotCtx)
          await persistUitwisselbaarKeuzes(a.id, regelsA)
          await persistUitwisselbaarKeuzes(b.id, regelsB)
          await triggerAutoplanForMaatwerk(regelsB)
          return { split: true as const, standaard: a, maatwerk: b }
        }

        // IO-split flow: lever_modus=deelleveringen + ≥1 regel met IO-tekort.
        // Splits in 2 orders: directe levering (voorraad + uitwisselbaar, mét verzend)
        // en IO-deel (zonder verzend, één zending op laatste IO-leverdatum).
        const effectieveModus = overrideLeverModus ?? headerWithModus.lever_modus
        const heeftIoTekort = regels.some(r => berekenRegelDekking(r).ioTekort > 0)

        if (effectieveModus === 'deelleveringen' && heeftIoTekort) {
          const directeRegels: OrderRegelFormData[] = []
          const ioRegels: OrderRegelFormData[] = []
          let shippingRegel: OrderRegelFormData | null = null

          for (const r of regels) {
            if (r.artikelnr === SHIPPING_PRODUCT_ID) {
              shippingRegel = r  // pas later toewijzen aan duurste deel (issue #33)
              continue
            }
            const d = berekenRegelDekking(r)
            const directDeel = d.direct + d.uitwisselbaar

            if (d.ioTekort === 0) {
              directeRegels.push(r)
            } else if (directDeel === 0) {
              // Volledig op IO
              ioRegels.push({ ...r, uitwisselbaar_keuzes: [] })
            } else {
              // Per-regel splitsing
              const prijs = r.prijs ?? 0
              const korting = (r.korting_pct ?? 0) / 100
              directeRegels.push({
                ...r,
                orderaantal: directDeel,
                te_leveren: directDeel,
                bedrag: Math.round(prijs * directDeel * (1 - korting) * 100) / 100,
              })
              ioRegels.push({
                ...r,
                id: undefined,
                orderaantal: d.ioTekort,
                te_leveren: d.ioTekort,
                uitwisselbaar_keuzes: [],
                bedrag: Math.round(prijs * d.ioTekort * (1 - korting) * 100) / 100,
              })
            }
          }

          // Issue #33: verzendkosten naar duurste sub-order (i.p.v. altijd directe).
          if (shippingRegel) {
            const totaalDirect = directeRegels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
            const totaalIo = ioRegels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
            if (totaalIo > totaalDirect) ioRegels.push(shippingRegel)
            else directeRegels.push(shippingRegel)
          }

          const directeOrder: OrderFormData = { ...orderData, lever_modus: 'in_een_keer' }
          // De IO-order hangt aan de IO-leverdatum (mig 153 zet afleverdatum vooruit)
          const ioOrder: OrderFormData = { ...orderData, lever_modus: 'in_een_keer' }

          const a = await createOrder(directeOrder, directeRegels, snapshotCtx)
          const b = await createOrder(ioOrder, ioRegels, snapshotCtx)
          await persistUitwisselbaarKeuzes(a.id, directeRegels)
          await persistUitwisselbaarKeuzes(b.id, ioRegels)
          await triggerAutoplanForMaatwerk(directeRegels)
          return { split: true as const, standaard: a, maatwerk: b }
        }

        const single = await createOrder(orderData, regels, snapshotCtx)
        await persistUitwisselbaarKeuzes(single.id, regels)
        await triggerAutoplanForMaatwerk(regels)
        return { split: false as const, ...single }
      } else {
        const orderId = initialData!.orderId
        await updateOrderWithLines(orderId, orderData, regels, snapshotCtx)
        await persistUitwisselbaarKeuzes(orderId, regels)
        await triggerAutoplanForMaatwerk(regels)
        return { split: false as const, id: orderId, order_nr: '' }
      }
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      // Reservering-Module (ADR-0015): persistUitwisselbaarKeuzes roept
      // set_uitwisselbaar_claims-RPC aan; allocator-triggers muteren
      // order_reserveringen op aantal-wijzigingen. Refresh claim/levertijd/
      // handmatige-keuzes + producten.gereserveerd-afgeleide queries.
      invalidateNaReserveringsmutatie(queryClient)
      // Snijplanning is mogelijk gewijzigd door triggerAutoplanForMaatwerk
      queryClient.invalidateQueries({ queryKey: ['snijplanning'] })
      queryClient.invalidateQueries({ queryKey: ['snijvoorstel'] })
      queryClient.invalidateQueries({ queryKey: ['productie', 'dashboard'] })
      // Pick & Ship filtert op pickbaarheid, dus een nieuwe of gewijzigde
      // order moet de cache verversen — anders wacht de operator tot
      // staleTime (30s) verloopt voor de order verschijnt.
      queryClient.invalidateQueries({ queryKey: ['pick-ship'] })
      // Mig 229: afleverdatum/adres/debiteur/afhalen zijn dimensies van de
      // bundel-sleutel — een mutatie kan orders tussen voorgestelde-bundels
      // doen schuiven. Refetch de live preview.
      queryClient.invalidateQueries({ queryKey: ['voorgestelde-bundels'] })

      if (mode === 'create' && onAfterCreate) {
        const ids = data.split ? [data.standaard.id, data.maatwerk.id] : [data.id]
        try {
          await onAfterCreate(ids)
        } catch (e) {
          setError(
            e instanceof Error
              ? `Order opgeslagen, maar uploaden van bijlagen mislukte: ${e.message}`
              : 'Order opgeslagen, maar uploaden van bijlagen mislukte',
          )
          return
        }
      }

      if (data.split) {
        navigate('/orders')
      } else {
        navigate(`/orders/${data.id}`)
      }
    },
    onError: (err) => {
      setError(
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Er ging iets mis',
      )
    },
  })

  // IO-tekort = stuks die niet via voorraad eigen artikel + uitwisselbaar gedekt zijn
  // → echte wacht-op-inkoop. Alleen dán moet LeverModusDialog openen.
  // Gebruikt gedeelde helper berekenRegelDekking — zelfde bron als inline tekst.
  const tekortRegels: LeverModusTekort[] = useMemo(
    () => regels
      .map((r, i) => {
        if (r.artikelnr === SHIPPING_PRODUCT_ID || r.is_pseudo) return null
        const { ioTekort } = berekenRegelDekking(r)
        if (ioTekort <= 0) return null
        return {
          regelnummer: i + 1,
          artikelnr: r.artikelnr ?? null,
          aantal_tekort: ioTekort,
          verwachte_leverweek: null,
        } as LeverModusTekort
      })
      .filter((x): x is LeverModusTekort => x !== null),
    [regels],
  )

  const handleSaveClick = () => {
    setError(null)
    if (tekortRegels.length > 0 && !header.lever_modus) {
      setLeverModusDialogOpen(true)
      return
    }
    saveMutation.mutate(undefined)
  }

  const handleLeverModusConfirm = (modus: LeverModus) => {
    setHeader(h => ({ ...h, lever_modus: modus }))
    setLeverModusDialogOpen(false)
    saveMutation.mutate(modus)
  }

  const isLocked = initialData?.status === 'Verzonden' || initialData?.status === 'Geannuleerd'

  if (isLocked) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius)] p-4 text-sm text-amber-700">
        Deze order heeft status "{initialData?.status}" en kan niet meer bewerkt worden.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] p-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Client selection */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Klant *</label>
        <ClientSelector
          value={client}
          onChange={handleClientChange}
          disabled={mode === 'edit' && !!client?.debiteur_nr && initialData?.status !== 'Concept'}
        />
      </div>

      {/* Header fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Klant referentie" value={header.klant_referentie} onChange={(v) => setHeader({ ...header, klant_referentie: v })} />
        <LeverDatumField
          leverType={header.lever_type ?? 'week'}
          afleverdatum={header.afleverdatum}
          onLeverTypeChange={(nieuw) => {
            setAfleverdatumOverridden(true)
            setHeader((h) => ({ ...h, lever_type: nieuw }))
          }}
          onChange={(nieuweDatum, weekNr) => {
            setAfleverdatumOverridden(true)
            setHeader({ ...header, afleverdatum: nieuweDatum, week: weekNr })
          }}
        />
      </div>

      {/* Levertijd-Module (ADR-0020): inline fit-indicator + "klant heeft haast"-
          knop, gekoppeld aan de huidige afleverdatum. Read-only waarschuwing —
          blokkeert de save-flow niet, want commit blijft de operator-keuze. */}
      {persistedRegelIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <LevertijdFitIndicator
            regelIds={persistedRegelIds}
            gewensteWeek={gewensteWeek}
          />
          <SnelsteHaalbaarKnop
            orderId={initialData?.orderId ?? null}
            regelIds={persistedRegelIds}
            onOvernemen={(gekozenWeek) => {
              const nieuweDatum = verzendWeekStringToDatum(gekozenWeek)
              if (!nieuweDatum) return
              const wk = verzendWeekVoor(nieuweDatum)
              if (mode === 'edit' && initialData?.orderId) {
                // Edit-mode: persisteer direct via Module-mutation (zet trigger
                // levertijd_status om naar eerder_/later_dan_standaard).
                neemSnelsteOver.mutate({
                  orderId: initialData.orderId,
                  gekozenWeek,
                })
              }
              // Spiegel altijd ook in de lokale form-state zodat UI direct
              // synchroon is met de mutation (create-mode heeft alleen dit pad).
              setAfleverdatumOverridden(true)
              setHeader((h) => ({
                ...h,
                afleverdatum: nieuweDatum,
                week: wk ? String(wk.week) : h.week,
              }))
            }}
          />
        </div>
      )}

      {/* Real-time levertijd-suggestie voor maatwerk-regels */}
      {levertijdInput && (
        <LevertijdSuggestie
          kwaliteitCode={levertijdInput.kwaliteitCode}
          kleurCode={levertijdInput.kleurCode}
          lengteCm={levertijdInput.lengteCm}
          breedteCm={levertijdInput.breedteCm}
          vorm={levertijdInput.vorm}
          gewensteLeverdatum={header.afleverdatum ?? null}
          debiteurNr={client?.debiteur_nr ?? null}
          fallbackDatum={afleverdatumInfo.langsteDatum}
          onNeemOver={(leverDatum, week) => {
            setAfleverdatumOverridden(true)
            setHeader((h) => ({ ...h, afleverdatum: leverDatum, week: String(week) }))
          }}
          spoedActief={spoedActief}
          onSpoedToggle={(actief, leverDatum, week, toeslag) => {
            setSpoedActief(actief)
            setRegels((r) => applySpoedToeslag(r, actief, toeslag || SPOED_FALLBACK_BEDRAG))
            if (actief && leverDatum) {
              setAfleverdatumOverridden(true)
              setHeader((h) => ({ ...h, afleverdatum: leverDatum, week: week ? String(week) : h.week }))
            }
          }}
        />
      )}

      {/* Deelleveringen + levertermijn-hint */}
      {client && mode === 'create' && (
        <div className="text-xs text-slate-500 space-y-1">
          {afleverdatumInfo.heeftGemengd && (
            <div>
              Standaard-maat regels: <span className="font-medium text-slate-700">{afleverdatumInfo.standaardDatum}</span>
              {' · '}
              Maatwerk regels: <span className="font-medium text-slate-700">{afleverdatumInfo.maatwerkDatum}</span>
            </div>
          )}
          {client.deelleveringen_toegestaan && afleverdatumInfo.heeftGemengd && (
            <label className="inline-flex items-center gap-2 text-slate-700">
              <input
                type="checkbox"
                checked={deelleveringen}
                onChange={(e) => setDeelleveringen(e.target.checked)}
                className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
              />
              Deelleveringen — order wordt bij aanmaken gesplitst in 2 losse orders (standaard + maatwerk)
            </label>
          )}
        </div>
      )}

      {/* Afhalen + address selector */}
      {client && (
        <div className="space-y-3">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={afhalen}
              onChange={(e) => handleAfhalenToggle(e.target.checked)}
              className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400/30"
            />
            Klant haalt zelf af — verzendkosten vervallen
          </label>
          <AddressSelector
            debiteurNr={client.debiteur_nr}
            onSelect={handleAddressSelect}
            disabled={afhalen}
          />
        </div>
      )}

      {/* Address preview */}
      {afhalen ? (
        <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] p-3 text-sm text-amber-800">
          Order wordt door de klant opgehaald — er wordt geen afleveradres gebruikt en geen verzendkosten in rekening gebracht.
        </div>
      ) : (
        client && header.afl_naam && (
          <div className="grid grid-cols-2 gap-4">
            <InvoiceAddressEditor
              debiteurNr={client.debiteur_nr}
              currentAdres={{
                naam: header.fact_naam ?? '',
                adres: header.fact_adres ?? '',
                postcode: header.fact_postcode ?? '',
                plaats: header.fact_plaats ?? '',
                land: header.fact_land ?? 'NL',
              }}
              currentContact={{
                email_factuur: client.email_factuur ?? '',
                email_overig: client.email_overig ?? '',
              }}
              onAdresChange={handleFactuurAdresChange}
              onSavedAsDefault={handleFactuurAdresSavedAsDefault}
            />
            <AddressPreview title="Afleveradres" naam={header.afl_naam} adres={header.afl_adres} postcode={header.afl_postcode} plaats={header.afl_plaats} />
          </div>
        )
      )}

      {/* Order lines */}
      <OrderLineEditor
        lines={regels}
        prijslijstNr={client?.prijslijst_nr ?? undefined}
        debiteurNr={client?.debiteur_nr ?? undefined}
        onChange={(newRegels) => {
          // Detect manual changes to the VERZEND line
          const oldShipping = regels.find(l => l.artikelnr === SHIPPING_PRODUCT_ID)
          const newShipping = newRegels.find(l => l.artikelnr === SHIPPING_PRODUCT_ID)

          if (oldShipping && !newShipping) {
            // User removed the shipping line
            setShippingOverridden(true)
            setRegels(newRegels)
            applyAfleverdatum(newRegels, client)
            return
          }

          if (oldShipping && newShipping && oldShipping.bedrag !== newShipping.bedrag) {
            // User edited the shipping line amount
            setShippingOverridden(true)
            setRegels(newRegels)
            applyAfleverdatum(newRegels, client)
            return
          }

          // Normal change — apply shipping auto-logic if not overridden
          const finalRegels = shippingOverridden ? newRegels : applyShippingLogic(newRegels, client, afhalen)
          setRegels(finalRegels)
          applyAfleverdatum(finalRegels, client)
        }}
        defaultKorting={client?.korting_pct ?? 0}
        onArticleSelected={handleArticleSelected}
      />

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSaveClick}
          disabled={saveMutation.isPending || !client || regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID).length === 0}
          className="px-6 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
        >
          {saveMutation.isPending ? 'Opslaan...' : mode === 'create' ? 'Order aanmaken' : 'Wijzigingen opslaan'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/orders')}
          className="px-6 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50"
        >
          Annuleren
        </button>

        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="ml-auto px-6 py-2 border border-rose-200 text-rose-600 rounded-[var(--radius-sm)] text-sm font-medium hover:bg-rose-50 transition-colors"
          >
            Verwijderen
          </button>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-[var(--radius)] shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Order verwijderen?</h3>
            <p className="text-sm text-slate-600 mb-6">
              Weet je zeker dat je deze order wilt verwijderen? Dit kan niet ongedaan worden gemaakt.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-rose-600 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? 'Verwijderen...' : 'Ja, verwijderen'}
              </button>
            </div>
          </div>
        </div>
      )}

      <LeverModusDialog
        open={leverModusDialogOpen}
        tekorten={tekortRegels}
        defaultModus={client?.deelleveringen_toegestaan ? 'deelleveringen' : 'in_een_keer'}
        onConfirm={handleLeverModusConfirm}
        onCancel={() => setLeverModusDialogOpen(false)}
      />
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value?: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
      />
    </div>
  )
}

/**
 * Lever-datum-input (ADR 0014 / mig 244). Twee modi:
 *   - 'week' (B2B-default): ISO-week-picker. `afleverdatum` = vrijdag van de gekozen
 *     week. Bundel-/factuur-/pick-flow ongewijzigd.
 *   - 'datum' (B2C): date-picker. `afleverdatum` = exact die dag. Pick & Ship laat
 *     de order pas 1 werkdag vóór die dag verschijnen; snij-planning krijgt 'm
 *     2 werkdagen eerder kritiek.
 *
 * Toggle onder de input; week-picker gebruikt HTML5 `<input type="week">` voor
 * native ISO-week-picker met correct gedrag rond jaarwisseling.
 */
function LeverDatumField({
  leverType,
  afleverdatum,
  onLeverTypeChange,
  onChange,
}: {
  leverType: 'week' | 'datum'
  afleverdatum?: string
  onLeverTypeChange: (nieuw: 'week' | 'datum') => void
  onChange: (nieuweDatum: string | undefined, weekNr: string | undefined) => void
}) {
  const weekString = verzendWeekIsoString(afleverdatum ?? null)
  const info = verzendWeekVoor(afleverdatum ?? null)
  const vandaagDate = new Date()
  const vandaagIso =
    `${vandaagDate.getFullYear()}-${String(vandaagDate.getMonth() + 1).padStart(2, '0')}-` +
    String(vandaagDate.getDate()).padStart(2, '0')
  const huidigeWeek = verzendWeekVoor(vandaagIso)
  const relatief = verzendWeekRelatief(afleverdatum ?? null, vandaagDate)
  const isWeek = leverType === 'week'
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="block text-sm font-medium text-slate-700">
          {isWeek ? 'Verzendweek' : 'Leverdatum'}
        </label>
        {huidigeWeek && (
          <span className="text-xs text-slate-500">
            Vandaag: <span className="font-medium text-slate-700">Wk {huidigeWeek.week} · {huidigeWeek.jaar}</span>
          </span>
        )}
      </div>
      {isWeek ? (
        <input
          type="week"
          value={weekString}
          onChange={(e) => {
            const value = e.target.value
            if (!value) {
              onChange(undefined, undefined)
              return
            }
            const nieuweDatum = verzendWeekStringToDatum(value)
            if (!nieuweDatum) return
            const week = verzendWeekVoor(nieuweDatum)
            onChange(nieuweDatum, week ? String(week.week) : undefined)
          }}
          className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      ) : (
        <input
          type="date"
          value={afleverdatum ?? ''}
          onChange={(e) => {
            const value = e.target.value
            if (!value) {
              onChange(undefined, undefined)
              return
            }
            const week = verzendWeekVoor(value)
            onChange(value, week ? String(week.week) : undefined)
          }}
          className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      )}
      <div className="flex items-center gap-1 mt-2 p-0.5 bg-slate-100 rounded-[var(--radius-sm)] w-fit">
        <button
          type="button"
          onClick={() => onLeverTypeChange('week')}
          className={`px-3 py-1 text-xs font-medium rounded-[calc(var(--radius-sm)-2px)] transition ${
            isWeek ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Per week
        </button>
        <button
          type="button"
          onClick={() => onLeverTypeChange('datum')}
          className={`px-3 py-1 text-xs font-medium rounded-[calc(var(--radius-sm)-2px)] transition ${
            !isWeek ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Op datum
        </button>
      </div>
      {info && (
        <p className="mt-2 text-xs text-slate-500">
          {isWeek ? (
            <>
              Wk {info.week} · {info.jaar}
              {relatief && <span className="text-slate-400"> ({relatief})</span>}
              {' — gepickt in week '}
              {info.week - 1 || 52}
            </>
          ) : (
            <>
              Levering op specifieke dag — Wk {info.week} · {info.jaar}
              {relatief && <span className="text-slate-400"> ({relatief})</span>}
              {' — verschijnt in Pick & Ship 1 werkdag vóór levering'}
            </>
          )}
        </p>
      )}
    </div>
  )
}

function AddressPreview({ title, naam, adres, postcode, plaats }: {
  title: string; naam?: string; adres?: string; postcode?: string; plaats?: string
}) {
  return (
    <div className="bg-slate-50 rounded-[var(--radius-sm)] p-4">
      <div className="text-xs font-medium text-slate-500 mb-1">{title}</div>
      <div className="text-sm">
        {naam && <p className="font-medium">{naam}</p>}
        {adres && <p>{adres}</p>}
        <p>{[postcode, plaats].filter(Boolean).join(' ')}</p>
      </div>
    </div>
  )
}
