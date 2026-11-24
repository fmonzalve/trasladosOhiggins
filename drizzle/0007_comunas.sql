CREATE TABLE comunas_adicionales (
  clave TEXT PRIMARY KEY NOT NULL,
  nombre TEXT NOT NULL CHECK(length(nombre) BETWEEN 1 AND 100)
);
