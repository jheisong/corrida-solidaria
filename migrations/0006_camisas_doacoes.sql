-- Camisas e doações viram N-para-1 com inscricoes.
-- Pagamentos continuam sendo somente registro de recebimento Pix,
-- sem vínculo direto com camisa/doação (o status "pago vs devido"
-- é derivado pelo agregado).

CREATE TABLE IF NOT EXISTS camisas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inscricao_id  INTEGER NOT NULL REFERENCES inscricoes(id) ON DELETE CASCADE,
  tamanho       TEXT NOT NULL,
  valor         REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ATIVO',   -- ATIVO | CANCELADO
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  cancelado_em  TEXT
);
CREATE INDEX IF NOT EXISTS idx_camisas_inscricao ON camisas(inscricao_id);
CREATE INDEX IF NOT EXISTS idx_camisas_status    ON camisas(status);

CREATE TABLE IF NOT EXISTS doacoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inscricao_id  INTEGER NOT NULL REFERENCES inscricoes(id) ON DELETE CASCADE,
  valor         REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ATIVO',
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  cancelado_em  TEXT
);
CREATE INDEX IF NOT EXISTS idx_doacoes_inscricao ON doacoes(inscricao_id);
CREATE INDEX IF NOT EXISTS idx_doacoes_status    ON doacoes(status);

-- Backfill camisas: cada inscrição que pediu camisa vira 1 linha (a "principal").
-- Compras extras (pagamentos tipo=CAMISA) entram sem tamanho ('?') porque o
-- tamanho não era gravado em lugar nenhum; edite pelo painel se souber.
INSERT INTO camisas (inscricao_id, tamanho, valor, status, criado_em)
SELECT
  i.id,
  COALESCE(i.tamanho_camiseta, '?'),
  40,
  'ATIVO',
  i.created_at
FROM inscricoes i
WHERE i.quer_camiseta = 1
  AND NOT EXISTS (SELECT 1 FROM camisas c WHERE c.inscricao_id = i.id);

INSERT INTO camisas (inscricao_id, tamanho, valor, status, criado_em)
SELECT
  p.inscricao_id,
  '?',
  p.valor,
  CASE WHEN p.status LIKE 'REMOVIDA_%' THEN 'CANCELADO' ELSE 'ATIVO' END,
  p.criado_em
FROM pagamentos p
LEFT JOIN camisas c
  ON c.inscricao_id = p.inscricao_id
 AND (
      c.valor = p.valor
   OR (c.criado_em = (SELECT MIN(p2.criado_em) FROM pagamentos p2 WHERE p2.inscricao_id = p.inscricao_id))
 )
WHERE p.tipo = 'CAMISA'
  AND c.id IS NULL;

-- Backfill doações: doação informada no cadastro (se > 0) + cada pagamento avulso.
INSERT INTO doacoes (inscricao_id, valor, status, criado_em)
SELECT
  i.id,
  i.doacao_valor,
  'ATIVO',
  i.created_at
FROM inscricoes i
WHERE COALESCE(i.doacao_valor, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM doacoes d WHERE d.inscricao_id = i.id);

INSERT INTO doacoes (inscricao_id, valor, status, criado_em)
SELECT
  p.inscricao_id,
  p.valor,
  CASE WHEN p.status LIKE 'REMOVIDA_%' THEN 'CANCELADO' ELSE 'ATIVO' END,
  p.criado_em
FROM pagamentos p
LEFT JOIN doacoes d
  ON d.inscricao_id = p.inscricao_id
 AND d.valor = p.valor
 AND d.criado_em <= p.criado_em
WHERE p.tipo = 'DOACAO'
  AND d.id IS NULL;
