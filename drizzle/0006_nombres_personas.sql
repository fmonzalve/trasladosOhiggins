ALTER TABLE perfiles ADD COLUMN nombre TEXT
  CHECK(length(trim(nombre)) BETWEEN 1 AND 120);
--> statement-breakpoint
ALTER TABLE viajes ADD COLUMN solicitante_nombre TEXT
  CHECK(length(trim(solicitante_nombre)) BETWEEN 1 AND 120);
