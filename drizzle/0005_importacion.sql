ALTER TABLE viajes ADD COLUMN solicitante_correo TEXT;
--> statement-breakpoint
CREATE INDEX viajes_correo_ida ON viajes (solicitante_correo, ida, folio);
