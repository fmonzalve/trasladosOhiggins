ALTER TABLE viajes ADD COLUMN comentarios_revision TEXT
  CHECK(length(comentarios_revision) <= 500);
