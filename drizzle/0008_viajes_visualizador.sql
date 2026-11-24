ALTER TABLE viajes ADD COLUMN pasajero_correo TEXT;
--> statement-breakpoint
CREATE INDEX viajes_pasajero_ida ON viajes (pasajero_correo, ida, folio);
