-- Corrida Solidária de Prevenção à Saúde
-- Lions Clube Bento Gonçalves Cidade do Vinho
-- 08/11/2026

CREATE TABLE IF NOT EXISTS inscricoes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                TEXT NOT NULL,
  email               TEXT NOT NULL,
  telefone            TEXT NOT NULL,
  cpf                 TEXT,
  data_nascimento     TEXT NOT NULL,
  sexo                TEXT NOT NULL,
  cidade              TEXT NOT NULL,
  modalidade          TEXT NOT NULL CHECK (modalidade IN ('corrida-5km','caminhada-5km','kids-250m')),
  equipe              TEXT,
  quer_camiseta       INTEGER NOT NULL DEFAULT 0,
  tamanho_camiseta    TEXT CHECK (tamanho_camiseta IN ('PP','P','M','G','GG','XG','INFANTIL')),
  contato_emergencia  TEXT NOT NULL,
  aceite_termo        INTEGER NOT NULL CHECK (aceite_termo = 1),
  observacoes         TEXT,
  doacao_valor        REAL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inscricoes_email     ON inscricoes(email);
CREATE INDEX IF NOT EXISTS idx_inscricoes_created   ON inscricoes(created_at);
CREATE INDEX IF NOT EXISTS idx_inscricoes_modalidade ON inscricoes(modalidade);
