# Corrida Solidária de Prevenção à Saúde

Site de inscrições da **Corrida Solidária de Prevenção à Saúde** do
**Lions Clube Bento Gonçalves Cidade do Vinho**.

- **Data:** 08 de novembro de 2026 (domingo)
- **Local:** Pista atlética municipal — Bento Gonçalves / RS
- **Modalidades:** corrida 5 km · caminhada 5 km · kids 250 m

Stack: **Cloudflare Workers** + **D1** (SQLite serverless). Frontend estático
servido pelo próprio Worker.

## Estrutura

```
├── src/index.js       # Worker (API + fallback assets)
├── schema.sql         # Schema D1 (referência)
├── migrations/        # Migrations D1 (wrangler d1 migrations)
│   └── 0001_init.sql
├── public/            # Site estático
│   ├── index.html
│   └── img/logo.jpeg
├── wrangler.toml
└── .gitignore
```

## Desenvolvimento local

```bash
# 1. Instalar wrangler (uma vez)
npm i -g wrangler

# 2. Criar o D1 (uma vez) e copiar o database_id retornado para wrangler.toml
wrangler d1 create corrida-solidaria

# 3. Aplicar schema no banco local
wrangler d1 migrations apply corrida-solidaria --local

# 4. Definir senha do painel em .dev.vars (arquivo local, NÃO commitar)
echo 'PAINEL_SENHA="troque-esta-senha"' > .dev.vars

# 5. Subir dev server
wrangler dev
```

Acesse `http://localhost:8787`.

## Deploy

```bash
# Schema em produção
wrangler d1 migrations apply corrida-solidaria --remote

# Senha do painel (secret)
wrangler secret put PAINEL_SENHA

# Publicar
wrangler deploy
```

## API

### `POST /api/inscricao`

Corpo JSON. Campos:

| Campo | Tipo | Obrigatório | Observações |
|---|---|---|---|
| `nome` | string | sim | |
| `email` | string | sim | |
| `telefone` | string | sim | |
| `data_nascimento` | string | sim | AAAA-MM-DD |
| `sexo` | string | sim | `F`, `M`, `OUTRO`, `PREFIRO_NAO_INFORMAR` |
| `cidade` | string | sim | |
| `modalidade` | string | sim | `corrida-5km` \| `caminhada-5km` \| `kids-250m` |
| `contato_emergencia` | string | sim | Nome e telefone |
| `aceite_termo` | boolean | sim | Deve ser `true` |
| `equipe` | string | não | |
| `quer_camiseta` | boolean | não | |
| `tamanho_camiseta` | string | condicional | `PP`\|`P`\|`M`\|`G`\|`GG`\|`XG`\|`INFANTIL` (obrigatório se `quer_camiseta`) |
| `observacoes` | string | não | |
| `cpf` | string | não | |
| `doacao_valor` | number | não | Valor voluntário (Pix) |

**Resposta sucesso (201):**
```json
{ "ok": true, "id": 123, "mensagem": "Inscrição registrada com sucesso!..." }
```

**Resposta erro (400):**
```json
{ "ok": false, "mensagem": "E-mail inválido.", "erros": [...] }
```

### `GET /api/inscricoes` (painel)

Requer header `Authorization: Bearer <PAINEL_SENHA>`.

### `GET /api/health`

Retorna metadados do evento.

### `POST /api/webhook` (Sicredi → nosso Worker)

Endpoint chamado pelo Sicredi quando a cobrança é liquidada. Cadastrado
via `POST /api/webhook/pix/cadastrar` (requer `PAINEL_SENHA`). Também
aceita `POST /api/webhook/pix` (algumas variantes de PSP anexam `/pix`
ao URL cadastrado). Payload esperado: `{ "pix": [ { txid, endToEndId, valor, pagador } ] }`.

### `GET /api/pagamento/:txid`

Consulta status local (`ATIVA` | `CONCLUIDA` | ...). Usar no polling do
frontend enquanto o pagador não paga.

## Integração Pix Sicredi

1. Certificado mTLS liberado pelo Sicredi → subir na Cloudflare:
   ```bash
   wrangler mtls-certificate upload \
     --cert certificados/06304442000108.cer \
     --key  certificados/api-pix-lccidadedovinho.key \
     --name sicredi-pix
   ```
   Copiar `certificate_id` para o bloco `[[mtls_certificates]]` em
   `wrangler.toml` (binding `SICREDI`).

2. Validar que a chave privada casa com o certificado (mesmo hash):
   ```bash
   openssl x509 -modulus -noout -in certificados/06304442000108.cer | openssl md5
   openssl rsa  -modulus -noout -in certificados/api-pix-lccidadedovinho.key | openssl md5
   ```

3. KV para cache de token:
   ```bash
   wrangler kv namespace create TOKENS
   ```
   Colar o `id` no bloco `[[kv_namespaces]]` do `wrangler.toml`.

4. Secrets:
   ```bash
   wrangler secret put SICREDI_CLIENT_ID
   wrangler secret put SICREDI_CLIENT_SECRET
   wrangler secret put SICREDI_CHAVE_PIX
   wrangler secret put SICREDI_WEBHOOK_URL       # https://.../api/webhook
   wrangler secret put SICREDI_VALOR_INSCRICAO   # "50.00"
   ```
   Ambiente (não-secret): `SICREDI_AMBIENTE=homologacao|producao` em `[vars]`.

5. Migration:
   ```bash
   wrangler d1 migrations apply corrida-solidaria --remote
   ```

6. Cadastrar webhook no Sicredi:
   ```bash
   curl -X POST https://.../api/webhook/pix/cadastrar \
     -H "Authorization: Bearer $PAINEL_SENHA"
   ```

7. Conciliação diária de fallback: usar `listarPixIntervalo(env, inicio, fim)`
   de `src/sicredi.js`. **API é UTC**: subtrair 3h dos horários de Brasília.

## Segurança

- `PAINEL_SENHA` é secret do Worker — **nunca** commitar.
- `uploads/` e `certificados/` estão no `.gitignore`.
- Certificado + chave Sicredi vivem só na Cloudflare (via
  `wrangler mtls-certificate upload`). Runtime não lê o `.key` do disco.
- Rotacionar `SICREDI_CLIENT_ID`/`SECRET` e gerar novo par CSR/chave se
  as credenciais atuais já circularam fora do cofre.
- Formulário valida no cliente e no servidor.
