ALTER TABLE perfiles ADD COLUMN administra_perfiles INTEGER NOT NULL DEFAULT 0
  CHECK(administra_perfiles IN (0,1));
