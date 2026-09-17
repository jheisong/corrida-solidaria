# E-mail transacional — Resend

Plano de implementação do envio de e-mails do Treino Solidário. Nada aqui
foi implementado ainda; este documento resume o que já está configurado no
provedor, o que falta no Worker e como cada etapa deve ficar.

## Contexto

- **Provedor**: Resend (região São Paulo, `sa-east-1`).
- **Domínio verificado**: `treinosolidario.lccidadedovinho.com.br`.
- **DNS**: SPF, DKIM e MX de retorno criados via integração Cloudflare
  (todos `DNS only`, nenhum proxied).
- **API key**: já salva como secret no Cloudflare (`RESEND_API_KEY`).
- **Remetente**: `Treino Solidário <inscricoes@treinosolidario.lccidadedovinho.com.br>`.
- **reply-to**: `lionsclubebgcidadedovinho@gmail.com`.
  - O remetente PRECISA ser o domínio verificado (Gmail não pode ser
    remetente — não há como publicar SPF/DKIM em `gmail.com` e o DMARC do
    Google é `p=reject`). As respostas caem no Gmail do clube via `reply_to`.

## Estratégia de envio

Só um disparo é **automático**:

- **Confirmação de inscrição** — enviada assim que `handleInscricao`,
  `handleComprarCamisa` e `handleDoacaoAvulsa` gravam o registro.

Todos os outros envios (pendências, oferta de camisa, avisos, etc.) são
**disparados manualmente pelo painel**, com filtros. Zero cron. Motivo:

- Volume do evento é baixo — o Lions decide quando comunicar.
- Cota Resend Free é 100/dia; disparo em lote controlado pelo painel evita
  estourar sem querer.
- Nenhum e-mail é enviado sem alguém ver o filtro selecionado antes.

## Variáveis / Secrets a configurar

Todas via `wrangler secret put NOME` (nunca hardcoded, nunca em `.dev.vars`
commitado):

| Nome | Já existe? | Valor |
|---|---|---|
| `RESEND_API_KEY`         | sim | secret gerada no Resend |
| `RESEND_FROM_EMAIL`      | falta | `inscricoes@treinosolidario.lccidadedovinho.com.br` |
| `RESEND_FROM_NAME`       | falta | `Treino Solidário` |
| `RESEND_REPLY_TO`        | falta | `lionsclubebgcidadedovinho@gmail.com` |
| `RESEND_WEBHOOK_SECRET`  | falta | secret gerada no Resend p/ assinar o webhook |
| `EMAIL_LIMITE_DIARIO`    | opcional | default `100` — usado só para aviso visual no painel |

## Modelo de dados

### Migration `0005_emails.sql`

```sql
ALTER TABLE inscricoes ADD COLUMN email_invalido   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inscricoes ADD COLUMN email_complained INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS emails_enviados (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inscricao_id  INTEGER REFERENCES inscricoes(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,     -- CONFIRMACAO | PENDENTE | OFERTA_CAMISA
                                   -- CONFIRMADO  | AVISO_GERAL
  destinatario  TEXT NOT NULL,
  assunto       TEXT NOT NULL,
  resend_id     TEXT,              -- id retornado pela API Resend
  status        TEXT NOT NULL,     -- ENVIADO | ENTREGUE | BOUNCED
                                   -- COMPLAINED | FALHOU
  ultimo_erro   TEXT,
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_emails_inscricao ON emails_enviados(inscricao_id);
CREATE INDEX IF NOT EXISTS idx_emails_status    ON emails_enviados(status);
CREATE INDEX IF NOT EXISTS idx_emails_resend    ON emails_enviados(resend_id);
CREATE INDEX IF NOT EXISTS idx_emails_dedupe    ON emails_enviados(inscricao_id, tipo, criado_em);
```

Antes de qualquer envio, checar pelo **e-mail** (não pelo atleta) — famílias
costumam reusar o mesmo endereço e um bounce contamina todos:

```sql
SELECT 1 FROM inscricoes
 WHERE email = ? AND (email_invalido = 1 OR email_complained = 1)
 LIMIT 1;
```

## Serviço de envio

`src/emails.js`:

```js
export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada.");
  const from = `${env.RESEND_FROM_NAME || "Treino Solidário"} <${env.RESEND_FROM_EMAIL}>`;
  const body = {
    from,
    to: Array.isArray(to) ? to : [to],
    reply_to: replyTo || env.RESEND_REPLY_TO,
    subject,
    html,
    text,
  };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let json = null;
  try { json = t ? JSON.parse(t) : null; } catch {}
  if (!r.ok) throw new Error(`Resend ${r.status}: ${t.slice(0, 500)}`);
  return json; // { id: "..." }
}
```

Sempre enviar `html` e `text` juntos (entregabilidade). Colocar atrás de
`sendEmail(env, params)` — se um dia trocar de provedor, mexe só nessa
função.

Wrapper que grava na tabela e trata bounce/complained:

```js
export async function enviarEregistrar(env, { inscricao_id, tipo, to, subject, html, text, replyTo }) {
  // Guard: não envia pra endereço queimado
  const queimado = await env.DB.prepare(
    "SELECT 1 FROM inscricoes WHERE email = ? AND (email_invalido = 1 OR email_complained = 1) LIMIT 1"
  ).bind(to).first();
  if (queimado) {
    await env.DB.prepare(
      "INSERT INTO emails_enviados (inscricao_id, tipo, destinatario, assunto, status, ultimo_erro) VALUES (?, ?, ?, ?, 'FALHOU', 'endereço marcado como inválido ou reclamado')"
    ).bind(inscricao_id, tipo, to, subject).run();
    return { ok: false, motivo: "endereço queimado" };
  }
  try {
    const r = await sendEmail(env, { to, subject, html, text, replyTo });
    await env.DB.prepare(
      "INSERT INTO emails_enviados (inscricao_id, tipo, destinatario, assunto, resend_id, status) VALUES (?, ?, ?, ?, ?, 'ENVIADO')"
    ).bind(inscricao_id, tipo, to, subject, r.id).run();
    return { ok: true, resend_id: r.id };
  } catch (e) {
    await env.DB.prepare(
      "INSERT INTO emails_enviados (inscricao_id, tipo, destinatario, assunto, status, ultimo_erro) VALUES (?, ?, ?, ?, 'FALHOU', ?)"
    ).bind(inscricao_id, tipo, to, subject, String(e.message || e).slice(0, 500)).run();
    return { ok: false, motivo: String(e.message || e) };
  }
}
```

## Templates

Escrever em `src/emails.js` como funções que retornam `{subject, html, text}`.
Estilo: tabelas + CSS inline (compatibilidade Outlook), max-width 600px,
preheader oculto no topo, cor de destaque `#F5A800` (laranja do evento).

Placeholders comuns:

- `ORGANIZADOR`   = `Lions Clube Bento Gonçalves — Cidade do Vinho`
- `EMAIL_CONTATO` = `lionsclubebgcidadedovinho@gmail.com`
- `EVENTO`        = `Treino Solidário Contra o Diabetes`
- `DATA_EVENTO`   = `08/11/2026`
- `LOCAL_EVENTO`  = `Pista Atlética Municipal — Bento Gonçalves/RS`
- `LINK_SITE`     = `https://treinosolidario.lccidadedovinho.com.br`

Templates:

1. **`confirmacaoInscricao(dados)`** — automático. Placeholders adicionais:
   `NOME`, `NUMERO_INSCRICAO`, `CATEGORIA`, `TEM_CAMISETA`, `TAMANHO_CAMISETA`,
   `VALOR_CAMISETA`, `VALOR_DOACAO`, `VALOR_TOTAL`, `INSTRUCAO_1KG_ALIMENTO`.
   Se tem valor devido: botão "Pagar Pix" apontando pro deep link
   `https://treinosolidario.lccidadedovinho.com.br/#retomar?cpf=<cpf>`.

2. **`pagamentoPendente(dados)`** — disparado pelo painel. Placeholders:
   `NOME`, `NUMERO_INSCRICAO`, `CATEGORIA`, `VALOR` (residual),
   `DESCRICAO_ITENS` (ex.: "camisa G + doação R$ 10"), `LINK_PAGAMENTO`
   (deep link `/#retomar?cpf=<cpf>`). Não embutir imagem do QR.

3. **`ofertaCamisa(dados)`** — disparado pelo painel para atletas sem
   camisa. Placeholders: `NOME`, `CATEGORIA`, `VALOR_CAMISETA`, `LINK_SITE`,
   `TAMANHOS_DISPONIVEIS`.

4. **`pagamentoConfirmado(dados)`** — automático via `handleWebhookPix`.
   Placeholders: `NOME`, `NUMERO_INSCRICAO`, `TIPO` (INSCRICAO | CAMISA |
   DOACAO | MISTO), `VALOR_PAGO`, `E2EID`, `DATA_PAGAMENTO`,
   `PROXIMOS_PASSOS` (bloco fixo sobre retirada de pulseira + 1 kg de
   alimento).

5. **`avisoGeral(dados)`** — livre, editado no painel: campo assunto e
   corpo em HTML/texto por quem opera. Placeholders básicos: `NOME`,
   `CATEGORIA`.

## Fluxo de disparo

### Automáticos

- `handleInscricao` — após criar cobrança, `ctx.waitUntil(enviarEregistrar(
  env, { tipo: 'CONFIRMACAO', ... }))`. Não bloqueia a resposta HTTP.
- `handleComprarCamisa` / `handleDoacaoAvulsa` — idem, mesmo template
  (contexto adaptado).
- `handleWebhookPix` — ao marcar `CONCLUIDA`, enfileirar `CONFIRMADO`.
  Se a cobrança estava `REMOVIDA_PELO_USUARIO_RECEBEDOR` (pagamento cruzou
  com o cancelamento): disparar também um alerta interno para
  `lionsclubebgcidadedovinho@gmail.com` com atleta + e2eid.

Para `ctx.waitUntil` funcionar, propagar `ctx` até o handler.

### Manuais (via painel)

Rota autenticada `POST /api/painel/emails`. Body:

```json
{
  "filtro": "pendentes_sem_email",   // ver lista abaixo
  "tipo":   "PENDENTE",              // template a usar
  "extra":  { "assunto": "...", "corpo_html": "..." }   // só para AVISO_GERAL
}
```

Handler:

1. Autoriza (`Authorization: Bearer PAINEL_SENHA`).
2. Executa a query do filtro → lista de `{inscricao_id, nome, email, ...}`.
3. Para cada linha, `enviarEregistrar(env, {...})`.
4. Devolve `{ total, enviados, falhou, cota_diaria_restante }`.

Sempre em série (não paralelizar) — Resend rate limit é conservador e a
tabela `emails_enviados` fica em ordem cronológica correta.

Frontend do painel: tela nova "Enviar e-mails" com:
- Combo do filtro (mostra contagem antes de enviar)
- Combo do template
- Preview do template com dados fake
- Botão "Enviar" com confirmação `"Vai enviar N e-mails. Continuar?"`
- Aviso se `N > cota_diaria_restante`
- Resultado ao final: quantos enviados, quantos falharam, link p/ ver
  linhas falhadas na tabela `emails_enviados`.

## Filtros do painel

| ID do filtro | Descrição | Query resumida |
|---|---|---|
| `todos` | Todos os inscritos com e-mail válido | `email_invalido=0 AND email_complained=0` |
| `pendentes` | Com valor residual > 0 (independe de e-mail) | esperado − pago > 0 |
| `pendentes_sem_email` | Pendentes que ainda não receberam nenhum `PENDENTE` | `LEFT JOIN emails_enviados … WHERE tipo='PENDENTE' IS NULL` |
| `pendentes_email_antigo_48h` | Pendentes cujo último `PENDENTE` foi enviado há > 48h | `MAX(criado_em) < datetime('now','-48 hours')` |
| `sem_camisa` | Inscrição sem camisa (para oferecer) | `quer_camiseta = 0` |
| `sem_camisa_sem_oferta` | Sem camisa e nunca recebeu `OFERTA_CAMISA` | idem + LEFT JOIN |
| `pagos_hoje` | Pagou nas últimas 24h e não recebeu `CONFIRMADO` | ... |

Regra geral: **todo filtro exclui `email_invalido=1 OR email_complained=1`
e exclui inscrições cujo e-mail não valida por regex**. Nunca reenvia pra
endereço queimado.

## Webhook Resend

Rota: `POST /api/webhooks/resend`.

1. Validar assinatura Svix (Resend usa Svix) com `RESEND_WEBHOOK_SECRET`.
   Header: `Svix-Signature`. Doc:
   https://resend.com/docs/dashboard/webhooks/verify-webhooks
2. Tratar eventos:
   - `email.bounced` → `UPDATE inscricoes SET email_invalido = 1 WHERE
     email = ?` (marca todas as inscrições com esse endereço) e
     `UPDATE emails_enviados SET status='BOUNCED', atualizado_em=now WHERE
     resend_id = ?`.
   - `email.complained` → `email_complained = 1` (todas as inscrições) e
     `status='COMPLAINED'`.
   - `email.delivered` → `status='ENTREGUE'`.
   - `email.opened` → ignorar (opcional em MVP).
3. Sempre retornar 200 rapidamente — Resend faz retry agressivo se != 2xx.

Ignorar bounces com centenas de inscritos queima a reputação do domínio.

## DNS pendente — DMARC

Adicionar no Cloudflare:

```
TXT  _dmarc.treinosolidario   v=DMARC1; p=none; rua=mailto:jgatto.inf@gmail.com; fo=1
```

`p=none` monitora sem bloquear. Depois de 2-3 semanas de tráfego, se os
relatórios mostrarem SPF/DKIM alinhados, subir para `p=quarantine` e depois
`p=reject`. Relatórios em XML vão para o Gmail pessoal — ninguém no clube
vai tratá-los.

## Passos sugeridos (na ordem)

1. `wrangler secret put` das 4 secrets faltantes.
2. Migration `0005_emails.sql` (local + `--remote`).
3. `src/emails.js` com `sendEmail`, `enviarEregistrar` e os 5 templates.
4. Wire `CONFIRMACAO` em `handleInscricao` / `handleComprarCamisa` /
   `handleDoacaoAvulsa` via `ctx.waitUntil`.
5. Wire `CONFIRMADO` em `handleWebhookPix` (com alerta interno se veio de
   cobrança cancelada).
6. `POST /api/painel/emails` autenticado + filtros documentados acima.
7. `POST /api/webhooks/resend` + validação Svix.
8. Deep link no frontend: `abrirForm()` (ou `DOMContentLoaded`) lê
   `location.hash`. Se `#retomar?cpf=XXX`: preenche `#f-cpf`, dispara
   `mascaraCpf(el)` (que aciona `verificarCpfAuto`). Sem isso, o botão
   "Pagar Pix" do e-mail cai numa home comum.
9. Tela nova no painel: seleciona filtro + template, mostra contagem,
   preview, botão enviar, resultado final. Coluna "Último e-mail" (data +
   status) em cada linha da lista de atletas.
10. DNS DMARC no Cloudflare.

## Observações finais

- Nunca enviar sem checar `email_invalido = 0 AND email_complained = 0`.
- Rate limit padrão Resend Free: 100 emails/dia, 3.000/mês. Se o volume
  esperado do evento crescer, upgrade do plano.
- Testar `sendEmail` em modo dry-run: setar env var `EMAIL_DRY_RUN=1` que
  loga o payload mas não chama a API.
- Skill `/publicar` continua servindo — só cobrir com "aplicar migration
  0005 antes do primeiro deploy que inclua o envio".
