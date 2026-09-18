-- Status passa a ser gravado com 3 valores: PENDENTE | PAGO | CANCELADO.
-- Camisas/doações de inscrições cujo total pago já cobre o total devido
-- ativo viram PAGO. As demais viram PENDENTE. CANCELADO permanece.

UPDATE camisas
   SET status = 'PAGO'
 WHERE status = 'ATIVO'
   AND (SELECT COALESCE(SUM(p.valor), 0)
          FROM pagamentos p
         WHERE p.inscricao_id = camisas.inscricao_id
           AND p.status = 'CONCLUIDA')
       >=
       (SELECT COALESCE(SUM(c.valor), 0)
          FROM camisas c
         WHERE c.inscricao_id = camisas.inscricao_id
           AND c.status = 'ATIVO')
       +
       (SELECT COALESCE(SUM(d.valor), 0)
          FROM doacoes d
         WHERE d.inscricao_id = camisas.inscricao_id
           AND d.status = 'ATIVO');

UPDATE doacoes
   SET status = 'PAGO'
 WHERE status = 'ATIVO'
   AND (SELECT COALESCE(SUM(p.valor), 0)
          FROM pagamentos p
         WHERE p.inscricao_id = doacoes.inscricao_id
           AND p.status = 'CONCLUIDA')
       >=
       (SELECT COALESCE(SUM(c.valor), 0)
          FROM camisas c
         WHERE c.inscricao_id = doacoes.inscricao_id
           AND c.status = 'ATIVO')
       +
       (SELECT COALESCE(SUM(d.valor), 0)
          FROM doacoes d
         WHERE d.inscricao_id = doacoes.inscricao_id
           AND d.status = 'ATIVO');

-- Renomeia ATIVO restante pra PENDENTE.
UPDATE camisas SET status = 'PENDENTE' WHERE status = 'ATIVO';
UPDATE doacoes SET status = 'PENDENTE' WHERE status = 'ATIVO';
