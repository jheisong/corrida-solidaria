---
name: publicar
description: Publica o site Corrida Solidária no Cloudflare Workers (produção — treinosolidario.lccidadedovinho.com.br). Aplica migrations D1 pendentes em --remote, roda wrangler deploy, faz smoke test em prod e reporta o resultado. Trigger — usuário digita "/publicar", "publicar", "publica em prod", "deploy", "sobe pra prod", "manda pra Cloudflare".
---

# Publicar em produção — Cloudflare Workers

Você é o publisher do projeto Corrida Solidária (Lions Clube BG Cidade do Vinho). O deploy vai para `treinosolidario.lccidadedovinho.com.br` via Cloudflare Workers + D1 + KV + mTLS (Sicredi Pix).

## Regras

- **Nunca** rode nada que precise de secrets interativos (`wrangler secret put`, `wrangler login`) — pergunte ao usuário.
- **Nunca** faça `git push --force`, `git reset --hard`, ou apague `certificados/`, `.dev.vars`, `wrangler.toml`.
- Wrangler local: `./node_modules/.bin/wrangler` (nunca use `npx wrangler` — nesse ambiente `npx` não acha o pacote).
- Deploy sempre em `--remote`. Local usa `wrangler dev`.
- Se algum passo falhar, PARE e reporte o erro exato ao usuário. Não invente workaround silencioso.

## Fluxo de deploy

1. **Pré-checks** (silencioso, só interrompe se falhar)
   - `./node_modules/.bin/wrangler whoami` → deve retornar OAuth ativa (conta `jgatto.inf@gmail.com`, ID `562dce6e21e0f619fe25da10daa73a9f`). Se não, pedir `wrangler login`.
   - `git status --porcelain` → informar se há arquivos modificados não commitados (aviso, não bloqueia).

2. **Migrations D1 remotas**
   - `./node_modules/.bin/wrangler d1 migrations list corrida-solidaria --remote` (pega pendentes)
   - Se houver pendentes: `./node_modules/.bin/wrangler d1 migrations apply corrida-solidaria --remote`.
   - Aplicações rodam em modo não-interativo (fallback yes automático).

3. **Deploy**
   - `./node_modules/.bin/wrangler deploy`
   - Verifica: linha `Deployed corrida-solidaria triggers` e `Current Version ID:` no output.
   - Confirma que o binding mTLS `SICREDI` (cert `e53450f5-0151-4938-abc5-96e2b47e6c8e`) e KV `TOKENS` (`c19d155ab3d7471f9fccdcfed901f6bd`) aparecem na lista de bindings.

4. **Smoke tests** (sequenciais em prod)
   - `curl -sS -o /dev/null -w "%{http_code}" https://treinosolidario.lccidadedovinho.com.br/api/health` → esperar 200.
   - `curl -sS https://treinosolidario.lccidadedovinho.com.br/ | grep -c "Corrida Solidária"` → esperar ≥ 1 (se retornar em-breve, avisar que `MOSTRAR_EM_BREVE=1` está ativo).
   - Se o commit atual tocou `src/sicredi.js` ou `src/index.js` no fluxo de cobrança, sugerir teste manual pagando R$ 0,01 (não faça sozinho — cria cobrança real).

5. **Se o SICREDI_WEBHOOK_URL mudou** (compare com o que você lembra ou pergunte ao usuário)
   - Precisa recadastrar: `curl -X POST https://treinosolidario.lccidadedovinho.com.br/api/webhook/pix/cadastrar -H "Authorization: Bearer <PAINEL_SENHA>"`.
   - Peça a senha ao usuário. Não hardcode.

## Report final ao usuário

Formato caveman-friendly, curto:

```
Deploy ok. Version <ID curto>.
Migrations: <n aplicadas | nenhuma pendente>.
Health: 200. Home: ok | em-breve ativo.
[warnings, se houver]
```

Se algo falhou, formato:

```
Deploy FALHOU no passo <n>.
Erro: <mensagem crua>.
Nada foi revertido no CF automaticamente.
Ação sugerida: <o que investigar>.
```

## Contexto útil (memoriza)

- **Domínio prod**: `treinosolidario.lccidadedovinho.com.br` (custom domain configurado em `wrangler.toml` `[routes]`).
- **D1 database_id**: `eb4a816e-4717-416f-ad7c-48c121f32ae5` (nome `corrida-solidaria`).
- **KV TOKENS id**: `c19d155ab3d7471f9fccdcfed901f6bd` (cache do OAuth Sicredi, TTL 300s).
- **mTLS certificate_id**: `e53450f5-0151-4938-abc5-96e2b47e6c8e` (cert `06304442000108`, expira 11/09/2028).
- **Secrets em prod** (nome apenas — valores só via `wrangler secret put`): `PAINEL_SENHA`, `SICREDI_CLIENT_ID`, `SICREDI_CLIENT_SECRET`, `SICREDI_CHAVE_PIX`, `SICREDI_WEBHOOK_URL`. Opcional: `MOSTRAR_EM_BREVE`.
- **Vars não-secretas** (`wrangler.toml [vars]`): `SICREDI_AMBIENTE = "producao"`.
- **Chave Pix Sicredi**: `06304442000108` (CNPJ Lions BG). Mesma chave usada no cadastro do webhook.
- **Não** setar `SICREDI_MOCK` em prod — habilitaria a rota `/api/dev/pagar/:txid` que dá baixa sintética em cobrança.

## Se aparecer erro comum

- `403 Access Denied` HTML na cobrança Sicredi → mTLS falhou. Cert na CF pode ter expirado ou binding foi removido. Checar `wrangler.toml [[mtls_certificates]]`.
- `401 Authorization ou certificado inválido` → credencial não bate com o cert atual. Usuário precisa gerar credencial nova no Portal Dev Sicredi sobre o `CERTIFICADO_VALIDADO` correto.
- `400 devedor.cpf inválido` → CPF não passa dígito verificador. Backend já valida (`validaCpf` em `src/index.js`); se aparecer, verificar se o cliente está enviando algo estranho.
- `UNIQUE constraint failed: inscricoes.cpf` numa migration → há CPFs duplicados no D1 remoto que precisam ser deduzidos manualmente antes de aplicar `0003_cpf_unique.sql`.
