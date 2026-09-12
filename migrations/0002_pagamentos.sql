-- Cobranças Pix (Sicredi API v3)
-- txid: 26-35 alfanuméricos, gerado pelo Worker e enviado no PUT /cob/{txid}

CREATE TABLE IF NOT EXISTS pagamentos (
  txid            TEXT PRIMARY KEY,
  inscricao_id    INTEGER NOT NULL REFERENCES inscricoes(id) ON DELETE CASCADE,
  valor           REAL NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ATIVA'
                    CHECK (status IN ('ATIVA','CONCLUIDA','REMOVIDA_PELO_USUARIO_RECEBEDOR','REMOVIDA_PELO_PSP')),
  chave_pix       TEXT NOT NULL,
  pix_copia_cola  TEXT,
  location_id     TEXT,
  e2eid           TEXT,
  pagador_nome    TEXT,
  pagador_cpf     TEXT,
  webhook_payload TEXT,
  criado_em       TEXT NOT NULL DEFAULT (datetime('now')),
  pago_em         TEXT
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_inscricao ON pagamentos(inscricao_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_status    ON pagamentos(status);
CREATE INDEX IF NOT EXISTS idx_pagamentos_e2eid     ON pagamentos(e2eid);
CREATE INDEX IF NOT EXISTS idx_pagamentos_criado    ON pagamentos(criado_em);
