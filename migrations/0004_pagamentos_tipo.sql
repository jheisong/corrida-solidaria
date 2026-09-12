-- Distingue produto do pagamento (inscrição, camisa, misto inscrição+doação).
ALTER TABLE pagamentos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'INSCRICAO';
CREATE INDEX IF NOT EXISTS idx_pagamentos_tipo ON pagamentos(tipo);
