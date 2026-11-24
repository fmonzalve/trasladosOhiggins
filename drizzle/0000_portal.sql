CREATE TABLE perfiles (
  correo TEXT PRIMARY KEY NOT NULL CHECK(correo = lower(trim(correo))),
  cargo TEXT NOT NULL,
  rol TEXT NOT NULL CHECK(rol IN ('jefatura','coordinacion','consulta')),
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1))
);
--> statement-breakpoint
CREATE TABLE viajes (
  folio TEXT PRIMARY KEY NOT NULL,
  solicitante TEXT NOT NULL,
  pasajero TEXT NOT NULL,
  unidad TEXT NOT NULL,
  origen TEXT NOT NULL,
  destino TEXT NOT NULL,
  ida TEXT NOT NULL,
  regreso TEXT NOT NULL CHECK(regreso > ida),
  notas TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','confirmado','realizado','cancelado')),
  creado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado TEXT,
  actualizado_por TEXT
);
--> statement-breakpoint
CREATE INDEX viajes_solicitante_ida ON viajes (solicitante, ida, folio);
--> statement-breakpoint
CREATE INDEX viajes_estado_ida ON viajes (estado, ida, folio);
