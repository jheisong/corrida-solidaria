/**
 * Corrida Solidária de Prevenção à Saúde
 * Lions Clube Bento Gonçalves Cidade do Vinho
 * Worker: rotas /api/* + assets estáticos em /public
 */

import { gerarTxid, criarCobranca, cadastrarWebhook } from "./sicredi.js";

const MODALIDADES = new Set(["corrida-5km", "caminhada-5km", "kids-250m"]);
const TAMANHOS = new Set(["PP", "P", "M", "G", "GG", "XG", "INFANTIL"]);
const SEXOS = new Set(["F", "M", "OUTRO", "PREFIRO_NAO_INFORMAR"]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...extraHeaders,
    },
  });
}

function strOrNull(v, max = 500) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function reqStr(v, campo, max = 500) {
  const s = strOrNull(v, max);
  if (!s) throw { campo, msg: `Campo "${campo}" é obrigatório.` };
  return s;
}

function validaEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function validaData(s) {
  // ISO YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime());
}

function parseInscricao(body) {
  const erros = [];
  const push = (e) => erros.push(e);

  let dados;
  try {
    dados = {
      nome: reqStr(body.nome, "nome", 120),
      email: reqStr(body.email, "email", 200).toLowerCase(),
      telefone: reqStr(body.telefone, "telefone", 40),
      data_nascimento: reqStr(body.data_nascimento, "data_nascimento", 10),
      sexo: reqStr(body.sexo, "sexo", 30).toUpperCase(),
      cidade: reqStr(body.cidade, "cidade", 120),
      modalidade: reqStr(body.modalidade, "modalidade", 30),
      contato_emergencia: reqStr(body.contato_emergencia, "contato_emergencia", 200),
      aceite_termo: body.aceite_termo === true || body.aceite_termo === 1 || body.aceite_termo === "true",
      equipe: strOrNull(body.equipe, 120),
      quer_camiseta: body.quer_camiseta === true || body.quer_camiseta === 1 || body.quer_camiseta === "true",
      tamanho_camiseta: strOrNull(body.tamanho_camiseta, 20),
      observacoes: strOrNull(body.observacoes, 1000),
      cpf: strOrNull(body.cpf, 20),
      doacao_valor: body.doacao_valor === undefined || body.doacao_valor === null || body.doacao_valor === "" ? null : Number(body.doacao_valor),
    };
  } catch (e) {
    if (e && e.campo) return { erros: [e] };
    throw e;
  }

  if (!validaEmail(dados.email)) push({ campo: "email", msg: "E-mail inválido." });
  if (!validaData(dados.data_nascimento)) push({ campo: "data_nascimento", msg: "Data de nascimento inválida (use AAAA-MM-DD)." });
  if (!MODALIDADES.has(dados.modalidade)) push({ campo: "modalidade", msg: "Modalidade inválida." });
  if (!SEXOS.has(dados.sexo)) push({ campo: "sexo", msg: "Sexo inválido." });
  if (!dados.aceite_termo) push({ campo: "aceite_termo", msg: "É obrigatório aceitar o termo de responsabilidade e a declaração de saúde." });
  if (dados.quer_camiseta && !dados.tamanho_camiseta) push({ campo: "tamanho_camiseta", msg: "Escolha o tamanho da camiseta." });
  if (dados.tamanho_camiseta && !TAMANHOS.has(dados.tamanho_camiseta)) push({ campo: "tamanho_camiseta", msg: "Tamanho inválido." });
  if (dados.doacao_valor !== null && (!Number.isFinite(dados.doacao_valor) || dados.doacao_valor < 0)) {
    push({ campo: "doacao_valor", msg: "Valor de doação inválido." });
  }

  return { erros, dados };
}

async function inserirInscricao(env, d) {
  const stmt = env.DB.prepare(`
    INSERT INTO inscricoes (
      nome, email, telefone, cpf, data_nascimento, sexo, cidade, modalidade,
      equipe, quer_camiseta, tamanho_camiseta, contato_emergencia,
      aceite_termo, observacoes, doacao_valor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    d.nome, d.email, d.telefone, d.cpf, d.data_nascimento, d.sexo, d.cidade, d.modalidade,
    d.equipe, d.quer_camiseta ? 1 : 0, d.tamanho_camiseta, d.contato_emergencia,
    1, d.observacoes, d.doacao_valor
  );
  const r = await stmt.run();
  return r.meta.last_row_id;
}

function autorizado(request, env) {
  if (!env.PAINEL_SENHA) return false;
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return m[1] === env.PAINEL_SENHA;
}

async function handleInscricao(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, mensagem: "Corpo da requisição inválido (JSON esperado)." }, 400);
  }

  const { erros, dados } = parseInscricao(body);
  if (erros.length) {
    return json({ ok: false, mensagem: erros[0].msg, erros }, 400);
  }

  let id;
  try {
    id = await inserirInscricao(env, dados);
  } catch (e) {
    console.error("Erro inserir inscrição:", e);
    return json({ ok: false, mensagem: "Não foi possível registrar sua inscrição. Tente novamente em instantes." }, 500);
  }

  const valor = calcularValor(env, dados);
  if (valor <= 0 || !env.SICREDI || !env.SICREDI_CHAVE_PIX) {
    return json({
      ok: true, id, valor,
      mensagem: "Inscrição registrada com sucesso! Você receberá a confirmação por e-mail.",
    }, 201);
  }

  try {
    const cob = await criarECadastrarCobranca(env, id, dados, valor);
    return json({
      ok: true, id, valor,
      pagamento: cob,
      mensagem: "Inscrição registrada. Pague o Pix para confirmar.",
    }, 201);
  } catch (e) {
    console.error("Erro criar cobrança:", e);
    return json({
      ok: true, id, valor,
      mensagem: "Inscrição registrada, mas não conseguimos gerar o Pix agora. Entraremos em contato.",
    }, 201);
  }
}

function calcularValor(env, dados) {
  const base = Number(env.SICREDI_VALOR_INSCRICAO || 0);
  const doacao = Number(dados.doacao_valor || 0);
  const total = (Number.isFinite(base) ? base : 0) + (Number.isFinite(doacao) ? doacao : 0);
  return Math.max(0, Math.round(total * 100) / 100);
}

async function criarECadastrarCobranca(env, inscricaoId, dados, valor) {
  const txid = gerarTxid("LCCV");
  const cob = await criarCobranca(env, {
    txid,
    valor,
    chavePix: env.SICREDI_CHAVE_PIX,
    cpf: dados.cpf,
    nome: dados.nome,
    solicitacao: `Inscrição Corrida Solidária - ${dados.modalidade}`,
    expiracao: 3 * 60 * 60,
    infoAdicionais: [
      { nome: "Inscricao", valor: String(inscricaoId) },
      { nome: "Modalidade", valor: dados.modalidade },
    ],
  });

  const pixCopiaCola = cob.pixCopiaECola || null;
  const locationId = cob.loc?.id ? String(cob.loc.id) : null;

  await env.DB.prepare(`
    INSERT INTO pagamentos (txid, inscricao_id, valor, status, chave_pix, pix_copia_cola, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(txid, inscricaoId, valor, cob.status || "ATIVA", env.SICREDI_CHAVE_PIX, pixCopiaCola, locationId).run();

  return { txid, valor, status: cob.status || "ATIVA", pixCopiaECola: pixCopiaCola };
}

async function handleWebhookPix(request, env) {
  let payload;
  try { payload = await request.json(); } catch {
    return json({ ok: false, mensagem: "JSON inválido" }, 400);
  }

  const eventos = Array.isArray(payload?.pix) ? payload.pix : [];
  if (!eventos.length) return json({ ok: true, ignorado: true });

  for (const ev of eventos) {
    const txid = ev.txid;
    const e2eid = ev.endToEndId;
    const valor = Number(ev.valor);
    if (!txid) continue;

    const existente = await env.DB.prepare("SELECT txid FROM pagamentos WHERE txid = ?").bind(txid).first();
    if (!existente) {
      console.warn("Webhook Pix para txid desconhecido:", txid);
      continue;
    }

    await env.DB.prepare(`
      UPDATE pagamentos
         SET status = 'CONCLUIDA',
             e2eid = ?,
             pagador_nome = COALESCE(?, pagador_nome),
             pagador_cpf  = COALESCE(?, pagador_cpf),
             webhook_payload = ?,
             pago_em = datetime('now')
       WHERE txid = ? AND status <> 'CONCLUIDA'
    `).bind(
      e2eid || null,
      ev.pagador?.nome || null,
      ev.pagador?.documento || ev.pagador?.cpf || ev.pagador?.cnpj || null,
      JSON.stringify(ev),
      txid,
    ).run();

    if (Number.isFinite(valor)) {
      // Validação simples: valor pago não pode ser menor que cobrado.
      const cob = await env.DB.prepare("SELECT valor FROM pagamentos WHERE txid = ?").bind(txid).first();
      if (cob && valor + 0.001 < Number(cob.valor)) {
        console.warn("Pagamento com valor menor que cobrado", { txid, valor, cobrado: cob.valor });
      }
    }
  }

  return json({ ok: true });
}

async function handlePagamentoStatus(request, env, txid) {
  const row = await env.DB.prepare(
    "SELECT txid, inscricao_id, valor, status, pix_copia_cola, pago_em, criado_em FROM pagamentos WHERE txid = ?"
  ).bind(txid).first();
  if (!row) return json({ ok: false, mensagem: "Cobrança não encontrada" }, 404);
  return json({ ok: true, pagamento: row });
}

async function handleDevPagar(request, env, txid) {
  const cob = await env.DB.prepare("SELECT txid, valor, chave_pix FROM pagamentos WHERE txid = ?").bind(txid).first();
  if (!cob) return json({ ok: false, mensagem: "txid não encontrado" }, 404);
  const fake = {
    pix: [{
      endToEndId: "E" + Date.now().toString().padStart(31, "0"),
      txid,
      valor: Number(cob.valor).toFixed(2),
      chave: cob.chave_pix,
      horario: new Date().toISOString(),
      pagador: { nome: "PAGADOR TESTE MOCK", documento: "12345678901", tipoDocumento: "CPF" },
    }],
  };
  const req = new Request("http://mock/api/webhook/pix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fake),
  });
  return handleWebhookPix(req, env);
}

async function handleCadastrarWebhook(request, env) {
  if (!autorizado(request, env)) return json({ ok: false, mensagem: "Não autorizado." }, 401);
  if (!env.SICREDI_CHAVE_PIX || !env.SICREDI_WEBHOOK_URL) {
    return json({ ok: false, mensagem: "SICREDI_CHAVE_PIX / SICREDI_WEBHOOK_URL não configurados." }, 400);
  }
  try {
    const r = await cadastrarWebhook(env, env.SICREDI_CHAVE_PIX, env.SICREDI_WEBHOOK_URL);
    return json({ ok: true, resposta: r });
  } catch (e) {
    console.error("Erro cadastrar webhook:", e);
    return json({ ok: false, mensagem: String(e.message || e) }, 502);
  }
}

async function handleListar(request, env) {
  if (!autorizado(request, env)) return json({ ok: false, mensagem: "Não autorizado." }, 401);
  const { results } = await env.DB.prepare(
    "SELECT * FROM inscricoes ORDER BY created_at DESC LIMIT 500"
  ).all();
  return json({ ok: true, total: results.length, inscricoes: results });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/inscricao" && request.method === "POST") {
      return handleInscricao(request, env);
    }
    if (url.pathname === "/api/inscricoes" && request.method === "GET") {
      return handleListar(request, env);
    }
    if (url.pathname === "/api/health") {
      return json({ ok: true, evento: "Corrida Solidária", data: "2026-11-08" });
    }
    // Sicredi pode postar em <url_cadastrada> ou <url_cadastrada>/pix.
    // Cadastre SICREDI_WEBHOOK_URL como "https://.../api/webhook".
    if ((url.pathname === "/api/webhook" || url.pathname === "/api/webhook/pix")
        && request.method === "POST") {
      return handleWebhookPix(request, env);
    }
    if (url.pathname === "/api/webhook/pix/cadastrar" && request.method === "POST") {
      return handleCadastrarWebhook(request, env);
    }
    {
      const m = url.pathname.match(/^\/api\/pagamento\/([A-Za-z0-9]{26,35})$/);
      if (m && request.method === "GET") return handlePagamentoStatus(request, env, m[1]);
    }
    if (env.SICREDI_MOCK === "1") {
      const m = url.pathname.match(/^\/api\/dev\/pagar\/([A-Za-z0-9]{26,35})$/);
      if (m && request.method === "POST") return handleDevPagar(request, env, m[1]);
    }

    // /painel → serve painel.html (autenticação é feita no cliente via Bearer).
    // Buscamos o arquivo diretamente e devolvemos o corpo, evitando o redirect
    // canônico ".html → sem extensão" do asset handler (que gera loop).
    if ((url.pathname === "/painel" || url.pathname === "/painel/") && env.ASSETS) {
      const painelUrl = new URL(url);
      painelUrl.pathname = "/painel.html";
      const r = await env.ASSETS.fetch(new Request(painelUrl.toString(), { method: "GET" }));
      if (r.status === 307 || r.status === 308) {
        const loc = r.headers.get("location");
        if (loc) {
          const alvo = new URL(loc, url);
          const r2 = await env.ASSETS.fetch(new Request(alvo.toString(), { method: "GET" }));
          return new Response(r2.body, { status: r2.status, headers: r2.headers });
        }
      }
      return new Response(r.body, { status: r.status, headers: r.headers });
    }

    // Domínio oficial mostra apenas o "em breve" até 15/09/2026 nos caminhos de página.
    // Assets (img/, css, js) e API continuam funcionando normalmente.
    const oficial = url.hostname.endsWith("lccidadedovinho.com.br");
    const ehPagina = url.pathname === "/" || url.pathname === "/index.html";
    if (oficial && ehPagina && env.ASSETS) {
      const emBreveUrl = new URL(url);
      emBreveUrl.pathname = "/em-breve.html";
      const r = await env.ASSETS.fetch(new Request(emBreveUrl.toString(), { method: "GET" }));
      if (r.status === 307 || r.status === 308) {
        const loc = r.headers.get("location");
        if (loc) {
          const alvo = new URL(loc, url);
          const r2 = await env.ASSETS.fetch(new Request(alvo.toString(), { method: "GET" }));
          return new Response(r2.body, { status: r2.status, headers: r2.headers });
        }
      }
      return new Response(r.body, { status: r.status, headers: r.headers });
    }

    // fallback: assets estáticos
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
