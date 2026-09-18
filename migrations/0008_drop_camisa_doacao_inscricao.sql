-- Remove colunas redundantes de inscricoes agora que camisas e doacoes
-- vivem em tabelas próprias. quer_camiseta permanece como flag rápida
-- (útil pra filtros simples "atleta tem alguma camisa cadastrada?").

ALTER TABLE inscricoes DROP COLUMN tamanho_camiseta;
ALTER TABLE inscricoes DROP COLUMN doacao_valor;
