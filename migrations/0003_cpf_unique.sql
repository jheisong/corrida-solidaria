-- CPF único (somente dígitos). Normaliza registros existentes antes do índice.
UPDATE inscricoes SET cpf = REPLACE(REPLACE(REPLACE(cpf, '.', ''), '-', ''), ' ', '') WHERE cpf IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inscricoes_cpf_unique
  ON inscricoes(cpf) WHERE cpf IS NOT NULL AND cpf <> '';
