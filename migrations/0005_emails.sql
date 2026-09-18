-- Flags de reputação por endereço + histórico de envios.
ALTER TABLE inscricoes ADD COLUMN email_invalido   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inscricoes ADD COLUMN email_complained INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS emails_enviados (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inscricao_id  INTEGER REFERENCES inscricoes(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,     -- CONFIRMACAO | PENDENTE | OFERTA_CAMISA
                                   -- CONFIRMADO  | AVISO_GERAL | ALERTA_INTERNO
  destinatario  TEXT NOT NULL,
  assunto       TEXT NOT NULL,
  resend_id     TEXT,              -- id retornado pela API Resend
  status        TEXT NOT NULL,     -- ENVIADO | ENTREGUE | BOUNCED
                                   -- COMPLAINED | FALHOU | BLOQUEADO
  ultimo_erro   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_emails_inscricao ON emails_enviados(inscricao_id);
CREATE INDEX IF NOT EXISTS idx_emails_status    ON emails_enviados(status);
CREATE INDEX IF NOT EXISTS idx_emails_resend    ON emails_enviados(resend_id);
CREATE INDEX IF NOT EXISTS idx_emails_dedupe    ON emails_enviados(inscricao_id, tipo, criado_em);
