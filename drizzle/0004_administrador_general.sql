ALTER TABLE perfiles ADD COLUMN administrador_general INTEGER NOT NULL DEFAULT 0
  CHECK(administrador_general IN (0,1));
