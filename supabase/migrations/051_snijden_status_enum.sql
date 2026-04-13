-- Migration 051: Voeg 'Snijden' toe aan snijplan_status enum
-- De drie sub-statussen Wacht/Gepland/In productie worden samengevoegd tot één 'Snijden' status.
-- Datamigrate gebeurt in 052 (enum ADD VALUE mag niet in dezelfde transactie gebruikt worden).

ALTER TYPE snijplan_status ADD VALUE IF NOT EXISTS 'Snijden' BEFORE 'Gesneden';
