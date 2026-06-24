-- Mig 486: producten.leverancier_id (FK -> leveranciers)
--
-- Het "+ Nieuw product"/"Bewerken"-formulier had al langer een Leverancier-
-- dropdown, maar producten had nooit een leverancier_id-kolom — elke save
-- via die formulieren faalde daardoor met 42703 (column does not exist).
-- Leverancier wordt verder alleen op inkooporders-niveau bijgehouden; dit
-- is de "default/gebruikelijke leverancier" voor het artikel zelf, puur
-- informatief (geen koppeling met de inkoop-flow).
--
-- ON DELETE SET NULL (mirrort producten_maatwerk_vorm_code_fkey): een
-- leverancier wordt in de praktijk soft-deleted (actief=false), maar als
-- die ooit toch verwijderd wordt mag dat een product nooit blokkeren.

ALTER TABLE producten
  ADD COLUMN leverancier_id BIGINT REFERENCES leveranciers(id) ON DELETE SET NULL;
