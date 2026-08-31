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

## Segurança

- `PAINEL_SENHA` é secret do Worker — **nunca** commitar.
- `uploads/` está no `.gitignore`; não colocar dados pessoais no repo público.
- Formulário valida no cliente e no servidor.
