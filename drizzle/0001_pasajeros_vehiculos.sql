ALTER TABLE viajes ADD COLUMN pasajeros_adicionales TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(pasajeros_adicionales) AND json_type(pasajeros_adicionales) = 'array');
--> statement-breakpoint
ALTER TABLE viajes ADD COLUMN vehiculo TEXT
  CHECK(vehiculo IN ('Taxi I','Taxi II','Taxi III','Taxi IV','Van'));
--> statement-breakpoint
ALTER TABLE viajes ADD COLUMN rechazado_en TEXT;
