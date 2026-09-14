/**
 * Cliente Sicredi API Pix v2/v3 rodando em Cloudflare Workers.
 *
 * mTLS: o certificado + chave privada são carregados na Cloudflare com
 *   wrangler mtls-certificate upload --cert certificados/06304442000108.cer \
 *     --key certificados/api-pix-lccidadedovinho.key --name sicredi-pix
 * e vinculados em wrangler.toml sob [[mtls_certificates]] binding = "SICREDI".
 * Aqui usamos env.SICREDI.fetch(...) — o runtime faz o handshake.
 *
 * Cache do access_token: KV binding TOKENS (token expira em 300s).
 * Cache local por isolate evita round-trip ao KV dentro da mesma requisição.
 */

const ISOLATE_CACHE = { token: null, exp: 0 };

function baseUrl(env) {
  return env.SICREDI_AMBIENTE === "producao"
    ? "https://api-pix.sicredi.com.br"
    : "https://api-pix-h.sicredi.com.br";
}

async function pegarTokenDoKV(env) {
  if (!env.TOKENS) return null;
  const raw = await env.TOKENS.get("sicredi:access_token", { type: "json" });
  if (!raw) return null;
  if (raw.exp <= Math.floor(Date.now() / 1000) + 10) return null;
  return raw;
}

async function salvarTokenNoKV(env, token, expiraEm) {
  if (!env.TOKENS) return;
  const exp = Math.floor(Date.now() / 1000) + expiraEm - 15;
  await env.TOKENS.put(
    "sicredi:access_token",
    JSON.stringify({ token, exp }),
    { expirationTtl: Math.max(30, expiraEm - 15) }
  );
}

async function obterToken(env) {
  const agora = Math.floor(Date.now() / 1000);
  if (ISOLATE_CACHE.token && ISOLATE_CACHE.exp > agora + 10) {
    return ISOLATE_CACHE.token;
  }
  const cached = await pegarTokenDoKV(env);
  if (cached) {
    ISOLATE_CACHE.token = cached.token;
    ISOLATE_CACHE.exp = cached.exp;
    return cached.token;
  }

  if (!env.SICREDI_CLIENT_ID || !env.SICREDI_CLIENT_SECRET) {
    throw new Error("SICREDI_CLIENT_ID/SECRET não configurados.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "cob.write cob.read pix.read webhook.read webhook.write",
  });

  const basic = btoa(`${env.SICREDI_CLIENT_ID}:${env.SICREDI_CLIENT_SECRET}`);

  const resp = await env.SICREDI.fetch(`${baseUrl(env)}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const texto = await resp.text();
  if (!resp.ok) {
    throw new Error(`Falha oauth/token ${resp.status}: ${texto.slice(0, 500)}`);
  }
  let json;
  try { json = JSON.parse(texto); } catch { throw new Error(`Resposta oauth não-JSON: ${texto.slice(0, 200)}`); }

  const expiresIn = Number(json.expires_in) || 300;
  ISOLATE_CACHE.token = json.access_token;
  ISOLATE_CACHE.exp = agora + expiresIn - 15;
  await salvarTokenNoKV(env, json.access_token, expiresIn);
  return json.access_token;
}

async function chamarApi(env, metodo, caminho, corpo) {
  const token = await obterToken(env);
  const resp = await env.SICREDI.fetch(`${baseUrl(env)}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* HTML de erro */ }
  return { status: resp.status, ok: resp.ok, json, texto };
}

/**
 * Gera txid válido (26-35 chars, [A-Za-z0-9]).
 * Prefixo curto ajuda a rastrear origem nos logs do Portal.
 */
export function gerarTxid(prefixo = "LCCV") {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b32 = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 35 - prefixo.length);
  return (prefixo + b32).slice(0, 35);
}

/**
 * PUT /api/v3/cob/{txid} — cria cobrança imediata.
 * modalidadeAlteracao=0: pagador não pode alterar valor.
 */
export async function criarCobranca(env, { txid, valor, chavePix, cpf, nome, solicitacao, expiracao = 3600, infoAdicionais }) {
  if (env.SICREDI_MOCK === "1") {
    // pixCopiaECola fixo — resposta real do Sicredi (2026-09-12, R$ 0,01, chave 06304442000108).
    // Serve para validar QR/UI sem bater na API. QR abre normal no app do banco.
    // Demais campos ecoam o que foi pedido para manter consistência no fluxo local.
    return {
      txid,
      status: "ATIVA",
      calendario: { criacao: new Date().toISOString(), expiracao },
      valor: { original: Number(valor).toFixed(2), modalidadeAlteracao: 0 },
      chave: chavePix,
      pixCopiaECola: "00020126850014br.gov.bcb.pix2563pixqrcode.sicredi.com.br/qr/v2/f9b0c2d2494249138f97c40dbde6bba85204000053039865802BR5903PIX6006Cidade62070503***63043543",
      loc: { id: 2444344789, location: "pixqrcode.sicredi.com.br/qr/v2/f9b0c2d2494249138f97c40dbde6bba8" },
      _mock: true,
    };
  }
  const body = {
    calendario: { expiracao },
    valor: { original: Number(valor).toFixed(2), modalidadeAlteracao: 0 },
    chave: chavePix,
    solicitacaoPagador: (solicitacao || "").slice(0, 140),
  };
  if (cpf && nome) body.devedor = { cpf: onlyDigits(cpf), nome: nome.slice(0, 200) };
  if (Array.isArray(infoAdicionais) && infoAdicionais.length) {
    body.infoAdicionais = infoAdicionais.slice(0, 50).map((i) => ({
      nome: String(i.nome).slice(0, 50),
      valor: String(i.valor).slice(0, 200),
    }));
  }

  const r = await chamarApi(env, "PUT", `/api/v3/cob/${encodeURIComponent(txid)}`, body);
  if (!r.ok) throw new Error(`Falha criar cobrança ${r.status}: ${(r.texto || "").slice(0, 500)}`);
  return r.json;
}

/**
 * Revisa cobrança existente. Único jeito prático de "cancelar" uma cobrança
 * imediata na Sicredi: forçar a expiração para 1s. Bacen não expõe status
 * REMOVIDA via API — o QR só sai do ar quando o calendário vence.
 */
export async function revisarCobrancaExpiracao(env, txid, expiracaoSegundos = 1) {
  if (env.SICREDI_MOCK === "1") return { txid, calendario: { expiracao: expiracaoSegundos }, _mock: true };
  const r = await chamarApi(env, "PATCH", `/api/v3/cob/${encodeURIComponent(txid)}`, {
    calendario: { expiracao: expiracaoSegundos },
  });
  if (!r.ok) throw new Error(`Falha revisar cobrança ${r.status}: ${(r.texto || "").slice(0, 500)}`);
  return r.json;
}

export async function consultarCobranca(env, txid) {
  const r = await chamarApi(env, "GET", `/api/v3/cob/${encodeURIComponent(txid)}`);
  if (!r.ok) throw new Error(`Falha consultar cobrança ${r.status}: ${(r.texto || "").slice(0, 500)}`);
  return r.json;
}

export async function consultarPixPorE2eid(env, e2eid) {
  const r = await chamarApi(env, "GET", `/api/v2/pix/${encodeURIComponent(e2eid)}`);
  if (!r.ok) throw new Error(`Falha consultar pix ${r.status}: ${(r.texto || "").slice(0, 500)}`);
  return r.json;
}

/**
 * PUT /api/v2/webhook/{chavePix}
 * URL deve ser HTTPS 443 com CA pública. Cloudflare atende.
 */
export async function cadastrarWebhook(env, chavePix, webhookUrl) {
  const r = await chamarApi(env, "PUT", `/api/v2/webhook/${encodeURIComponent(chavePix)}`, {
    webhookUrl,
  });
  if (!r.ok) throw new Error(`Falha cadastrar webhook ${r.status}: ${(r.texto || "").slice(0, 500)}`);
  return r.json ?? { ok: true };
}

export async function listarPixIntervalo(env, inicioIso, fimIso, opts = {}) {
  // API usa UTC. Chamador deve converter horário Brasília antes (subtrair 3h).
  // txIdPresente=true filtra somente Pix vinculados a cobranças (guia pág 22).
  const qs = new URLSearchParams({ inicio: inicioIso, fim: fimIso });
  qs.set("txIdPresente", opts.txIdPresente === false ? "false" : "true");
  if (opts.paginaAtual != null) qs.set("paginacao.paginaAtual", String(opts.paginaAtual));
  if (opts.itensPorPagina != null) qs.set("paginacao.itensPorPagina", String(opts.itensPorPagina));
  const r = await chamarApi(env, "GET", `/api/v2/pix?${qs.toString()}`);
  if (!r.ok) throw new Error(`Falha listar pix ${r.status}: ${(r.texto || "").slice(0, 500)}`);
  return r.json;
}

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}
