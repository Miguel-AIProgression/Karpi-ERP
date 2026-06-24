-- ============================================================================
-- 482: Nieuwe zending-status 'Afgehaald'
--
-- Afhaal-orders (orders.afhalen=TRUE → vervoerder "GEEN") krijgen nooit een
-- transportorder en blijven daardoor eeuwig op 'Klaar voor verzending' hangen:
-- de enige plek die 'Klaar voor verzending' → 'Onderweg' tilt is een
-- carrier-callback (markeer_transportorder_verstuurd), die hier niet bestaat.
-- Eigen vervoer (mig 429) loste een identiek probleem op door automatisch naar
-- 'Afgeleverd' te flippen; afhalen heeft een HANDMATIGE actie nodig — we weten
-- niet wanneer de klant ophaalt.
--
-- 'Afgehaald' is bewust een eigen eindstatus (geen hergebruik van 'Afgeleverd'):
-- afhalen ≠ door ons afgeleverd, en de operator wil ze in het overzicht kunnen
-- onderscheiden.
--
-- Aparte migratie van de RPC (483): een nieuw enum-value kan in PostgreSQL niet
-- in dezelfde transactie worden gebruikt als waarin het is toegevoegd.
-- ============================================================================

ALTER TYPE zending_status ADD VALUE IF NOT EXISTS 'Afgehaald';
