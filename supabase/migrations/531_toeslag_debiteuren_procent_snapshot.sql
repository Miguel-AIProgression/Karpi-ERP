-- Migratie 531: klant-toeslag — extra debiteuren + toeslag_procent snapshot
--
-- 1. facturen.toeslag_procent NUMERIC(5,2): snapshot van het percentage op het moment
--    dat de factuur wordt aangemaakt. De PDF kan daarna "Zuschlag 4,5%" tonen zonder
--    een join naar debiteuren nodig te hebben.
--
-- 2. Toeslag inschakelen voor (periode 2026-07-01 t/m 2026-12-31, 4,5 %, Duits):
--    - Lutz:        600556, 600562, 600571, 600572
--    - Zurbrüggen:  982110
--    - SB Möbel Boss (114 filialen uit debadres BOSS.xlsx):
--      120770, 150679, 150761-150876 (met gaten bij 150799-150801 en 150852)
--
-- Migraties 532/533 (mogen pas nádat 531 gedraaid heeft):
--    vullen toeslag_procent in bij nieuw aangemaakte facturen en wijzigen de
--    toeslagactivatie-check van CURRENT_DATE naar orders.created_at.

-- 1. Snapshot-kolom
ALTER TABLE facturen
  ADD COLUMN IF NOT EXISTS toeslag_procent NUMERIC(5,2);

-- 2. Debiteur-update
UPDATE debiteuren
   SET toeslag_actief        = TRUE,
       toeslag_procent       = 4.5,
       toeslag_omschrijving  = 'Wie vereinbart: Zuschlag von {percentage} % für den Zeitraum vom 1. Juli 2026 bis zum 31. Dezember 2026.',
       toeslag_begindatum    = '2026-07-01',
       toeslag_einddatum     = '2026-12-31'
 WHERE debiteur_nr IN (
   -- Lutz
   600556, 600562, 600571, 600572,
   -- Zurbrüggen
   982110,
   -- SB Möbel Boss (114 filialen uit debadres BOSS.xlsx)
   120770, 150679,
   150761, 150762, 150763, 150764, 150765, 150766, 150767, 150768, 150769, 150770,
   150771, 150772, 150773, 150774, 150775, 150776, 150777, 150778, 150779, 150780,
   150781, 150782, 150783, 150784, 150785, 150786, 150787, 150788, 150789, 150790,
   150791, 150792, 150793, 150794, 150795, 150796, 150797, 150798,
   150802, 150803, 150804, 150805, 150806, 150807, 150808, 150809, 150810,
   150811, 150812, 150813, 150814, 150815, 150816, 150817, 150818, 150819, 150820,
   150821, 150822, 150823, 150824, 150825, 150826, 150827, 150828, 150829, 150830,
   150831, 150832, 150833, 150834, 150835, 150836, 150837, 150838, 150839, 150840,
   150841, 150842, 150843, 150844, 150845, 150846, 150847, 150848, 150849, 150850,
   150851, 150853, 150854, 150855, 150856, 150857, 150858, 150859, 150860,
   150861, 150862, 150863, 150864, 150865, 150866, 150867, 150868, 150869, 150870,
   150871, 150872, 150873, 150874, 150875, 150876
 );
