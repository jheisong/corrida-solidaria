/**
 * Corrida Solidária de Prevenção à Saúde
 * Lions Clube Bento Gonçalves Cidade do Vinho
 * Worker: rotas /api/* + assets estáticos em /public
 */

import { gerarTxid, criarCobranca, cadastrarWebhook, revisarCobrancaExpiracao } from "./sicredi.js";

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

function normalizaCpf(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\D+/g, "");
  return s ? s.slice(0, 14) : null;
}

function validaCpf(cpf) {
  if (!cpf || cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;
  const calc = (fatorInicial) => {
    let soma = 0;
    for (let i = 0; i < fatorInicial - 1; i++) soma += Number(cpf[i]) * (fatorInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(10) === Number(cpf[9]) && calc(11) === Number(cpf[10]);
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
      sexo: (strOrNull(body.sexo, 30) || "").toUpperCase() || null,
      cidade: strOrNull(body.cidade, 120),
      modalidade: reqStr(body.modalidade, "modalidade", 30),
      contato_emergencia: strOrNull(body.contato_emergencia, 200),
      aceite_termo: body.aceite_termo === true || body.aceite_termo === 1 || body.aceite_termo === "true",
      equipe: strOrNull(body.equipe, 120),
      quer_camiseta: body.quer_camiseta === true || body.quer_camiseta === 1 || body.quer_camiseta === "true",
      tamanho_camiseta: strOrNull(body.tamanho_camiseta, 20),
      observacoes: strOrNull(body.observacoes, 1000),
      cpf: normalizaCpf(body.cpf),
      doacao_valor: body.doacao_valor === undefined || body.doacao_valor === null || body.doacao_valor === "" ? null : Number(body.doacao_valor),
    };
  } catch (e) {
    if (e && e.campo) return { erros: [e] };
    throw e;
  }

  if (!validaEmail(dados.email)) push({ campo: "email", msg: "E-mail inválido." });
  if (!validaData(dados.data_nascimento)) push({ campo: "data_nascimento", msg: "Data de nascimento inválida (use AAAA-MM-DD)." });
  if (!MODALIDADES.has(dados.modalidade)) push({ campo: "modalidade", msg: "Modalidade inválida." });
  if (dados.sexo && !SEXOS.has(dados.sexo)) push({ campo: "sexo", msg: "Sexo inválido." });
  if (!dados.aceite_termo) push({ campo: "aceite_termo", msg: "É obrigatório aceitar o termo de responsabilidade e a declaração de saúde." });
  if (dados.quer_camiseta && !dados.tamanho_camiseta) push({ campo: "tamanho_camiseta", msg: "Escolha o tamanho da camiseta." });
  if (dados.tamanho_camiseta && !TAMANHOS.has(dados.tamanho_camiseta)) push({ campo: "tamanho_camiseta", msg: "Tamanho inválido." });
  if (dados.doacao_valor !== null && (!Number.isFinite(dados.doacao_valor) || dados.doacao_valor < 0)) {
    push({ campo: "doacao_valor", msg: "Valor de doação inválido." });
  }
  if (!dados.cpf || !validaCpf(dados.cpf)) {
    push({ campo: "cpf", msg: "CPF inválido." });
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
    d.nome, d.email, d.telefone, d.cpf, d.data_nascimento, d.sexo || "", d.cidade || "", d.modalidade,
    d.equipe, d.quer_camiseta ? 1 : 0, d.tamanho_camiseta, d.contato_emergencia || "",
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

  const existente = await env.DB.prepare(
    "SELECT id, nome, quer_camiseta, tamanho_camiseta FROM inscricoes WHERE cpf = ? LIMIT 1"
  ).bind(dados.cpf).first();
  if (existente) {
    const pendente = await buscarPagamentoPendente(env, existente.id);
    const inscCompleta = await env.DB.prepare(
      "SELECT id, quer_camiseta, doacao_valor FROM inscricoes WHERE id = ?"
    ).bind(existente.id).first();
    const { residual } = await calcularResidual(env, inscCompleta);
    return json({
      ok: false,
      cpf_duplicado: true,
      mensagem: "Atleta já cadastrado.",
      inscricao: {
        id: existente.id,
        nome: existente.nome,
        tem_camiseta: !!existente.quer_camiseta,
        tamanho_camiseta: existente.tamanho_camiseta,
      },
      pagamento_pendente: pendente,
      pode_renovar: !pendente && residual > 0,
      valor_residual: residual,
    }, 409);
  }

  let id;
  try {
    id = await inserirInscricao(env, dados);
  } catch (e) {
    console.error("Erro inserir inscrição:", e);
    return json({ ok: false, mensagem: "Não foi possível registrar sua inscrição. Tente novamente em instantes." }, 500);
  }

  const valor = calcularValor(env, dados);
  const podeCobrar = env.SICREDI_MOCK === "1" || !!env.SICREDI;
  if (valor <= 0 || !podeCobrar || !env.SICREDI_CHAVE_PIX) {
    return json({
      ok: true, id, valor,
      mensagem: "Inscrição registrada com sucesso! Você receberá a confirmação por e-mail.",
    }, 201);
  }

  try {
    const temDoacao = Number(dados.doacao_valor || 0) > 0;
    const temCamisa = !!dados.quer_camiseta;
    const temInscricao = Number(env.SICREDI_VALOR_INSCRICAO || 0) > 0;
    let tipo = "INSCRICAO";
    if ((temDoacao && temCamisa) || (temInscricao && (temDoacao || temCamisa))) tipo = "MISTO";
    else if (temCamisa && !temInscricao && !temDoacao) tipo = "CAMISA";
    else if (temDoacao && !temInscricao && !temCamisa) tipo = "DOACAO";
    const cob = await criarECadastrarCobranca(env, id, dados, valor, tipo);
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

async function handleDoacaoAvulsa(request, env, inscricaoId) {
  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, mensagem: "JSON inválido" }, 400);
  }
  const cpfDigitos = normalizaCpf(body.cpf);
  const valor = Number(body.valor);
  if (!cpfDigitos || !validaCpf(cpfDigitos)) return json({ ok: false, mensagem: "CPF inválido." }, 400);
  if (!Number.isFinite(valor) || valor <= 0) return json({ ok: false, mensagem: "Valor inválido." }, 400);

  const insc = await env.DB.prepare("SELECT id, nome, cpf FROM inscricoes WHERE id = ?").bind(inscricaoId).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  if (insc.cpf !== cpfDigitos) return json({ ok: false, mensagem: "CPF não confere com a inscrição." }, 403);

  const podeCobrar = env.SICREDI_MOCK === "1" || !!env.SICREDI;
  if (!podeCobrar || !env.SICREDI_CHAVE_PIX) {
    return json({ ok: false, mensagem: "Pix indisponível no momento." }, 503);
  }

  try {
    const cob = await criarECadastrarCobranca(env, inscricaoId, { cpf: cpfDigitos, nome: insc.nome, modalidade: "doacao" }, Math.round(valor * 100) / 100, "DOACAO");
    return json({ ok: true, id: inscricaoId, valor, pagamento: cob, mensagem: "Pague o Pix da doação." }, 201);
  } catch (e) {
    console.error("Erro cobrança doação:", e);
    return json({ ok: false, mensagem: "Não conseguimos gerar o Pix agora." }, 502);
  }
}

async function buscarPagamentoPendente(env, inscricaoId) {
  const row = await env.DB.prepare(`
    SELECT txid, valor, tipo, pix_copia_cola, criado_em
      FROM pagamentos
     WHERE inscricao_id = ?
       AND status = 'ATIVA'
       AND datetime(criado_em, '+48 hours') > datetime('now')
     ORDER BY criado_em DESC
     LIMIT 1
  `).bind(inscricaoId).first();
  if (!row) return null;
  return {
    txid: row.txid,
    valor: row.valor,
    tipo: row.tipo,
    pixCopiaECola: row.pix_copia_cola,
    criado_em: row.criado_em,
  };
}

async function calcularResidual(env, insc) {
  // Valor que a inscrição deveria ter cobrado (base + camisa + doação).
  const base = Number(env.SICREDI_VALOR_INSCRICAO || 0);
  const camisa = insc.quer_camiseta ? Number(env.CAMISA_VALOR || 40) : 0;
  const doacao = Number(insc.doacao_valor || 0);
  const esperado = Math.round((base + camisa + doacao) * 100) / 100;
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(valor), 0) AS total FROM pagamentos WHERE inscricao_id = ? AND status = 'CONCLUIDA'"
  ).bind(insc.id).first();
  const pago = Math.round(Number(row?.total || 0) * 100) / 100;
  const residual = Math.max(0, Math.round((esperado - pago) * 100) / 100);
  return { esperado, pago, residual };
}

async function handleCancelarPendente(request, env, inscricaoId) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const cpfDigitos = normalizaCpf(body.cpf);
  if (!cpfDigitos || !validaCpf(cpfDigitos)) return json({ ok: false, mensagem: "CPF inválido." }, 400);

  const insc = await env.DB.prepare("SELECT id, cpf FROM inscricoes WHERE id = ?").bind(inscricaoId).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  if (insc.cpf !== cpfDigitos) return json({ ok: false, mensagem: "CPF não confere com a inscrição." }, 403);

  // Marca as cobranças ATIVA como removidas pelo recebedor no banco local
  // e força expiração=1s na Sicredi (único jeito de "invalidar" o QR via API,
  // já que o Bacen não expõe mudança de status). Se o PATCH falhar (rede,
  // versão de API), seguimos e a cobrança ainda expira pelo prazo natural.
  const { results: ativas } = await env.DB.prepare(
    "SELECT txid FROM pagamentos WHERE inscricao_id = ? AND status = 'ATIVA'"
  ).bind(inscricaoId).all();

  const patchErrors = [];
  for (const row of ativas || []) {
    try { await revisarCobrancaExpiracao(env, row.txid, 1); }
    catch (e) { patchErrors.push({ txid: row.txid, erro: String(e.message || e) }); }
  }

  const res = await env.DB.prepare(
    "UPDATE pagamentos SET status = 'REMOVIDA_PELO_USUARIO_RECEBEDOR' WHERE inscricao_id = ? AND status = 'ATIVA'"
  ).bind(inscricaoId).run();
  await env.DB.prepare(
    "UPDATE inscricoes SET quer_camiseta = 0, tamanho_camiseta = NULL, doacao_valor = NULL WHERE id = ?"
  ).bind(inscricaoId).run();

  if (patchErrors.length) console.error("Cancelar: falhas no PATCH Sicredi:", patchErrors);

  return json({
    ok: true,
    canceladas: res.meta?.changes ?? 0,
    mensagem: "Pedido cancelado.",
  });
}

async function handleRenovarPagamento(request, env, inscricaoId) {
  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, mensagem: "JSON inválido" }, 400);
  }
  const cpfDigitos = normalizaCpf(body.cpf);
  if (!cpfDigitos || !validaCpf(cpfDigitos)) return json({ ok: false, mensagem: "CPF inválido." }, 400);

  const insc = await env.DB.prepare(
    "SELECT id, nome, cpf, quer_camiseta, doacao_valor FROM inscricoes WHERE id = ?"
  ).bind(inscricaoId).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  if (insc.cpf !== cpfDigitos) return json({ ok: false, mensagem: "CPF não confere com a inscrição." }, 403);

  // Se ainda há cobrança ATIVA dentro do prazo (48h), reaproveita.
  const pendenteAtivo = await buscarPagamentoPendente(env, insc.id);
  if (pendenteAtivo) return json({ ok: true, id: insc.id, valor: pendenteAtivo.valor, pagamento: pendenteAtivo, mensagem: "Pagamento pendente reaproveitado." });

  const { residual } = await calcularResidual(env, insc);
  if (residual <= 0) return json({ ok: false, mensagem: "Não há valor pendente." }, 400);

  const podeCobrar = env.SICREDI_MOCK === "1" || !!env.SICREDI;
  if (!podeCobrar || !env.SICREDI_CHAVE_PIX) return json({ ok: false, mensagem: "Pix indisponível." }, 503);

  // Invalida qualquer ATIVA antiga (fora do filtro 48h) — evita QR órfão vivo
  // no Sicredi enquanto emitimos um novo. PATCH falho vira log, não bloqueia.
  const { results: antigas } = await env.DB.prepare(
    "SELECT txid FROM pagamentos WHERE inscricao_id = ? AND status = 'ATIVA'"
  ).bind(insc.id).all();
  for (const a of antigas || []) {
    try { await revisarCobrancaExpiracao(env, a.txid, 1); }
    catch (e) { console.error("Renovar: PATCH falhou p/ txid", a.txid, String(e.message || e)); }
  }
  if (antigas && antigas.length) {
    await env.DB.prepare(
      "UPDATE pagamentos SET status = 'REMOVIDA_PELO_USUARIO_RECEBEDOR' WHERE inscricao_id = ? AND status = 'ATIVA'"
    ).bind(insc.id).run();
  }

  const tipo = insc.quer_camiseta && Number(insc.doacao_valor || 0) > 0 ? "MISTO"
    : insc.quer_camiseta ? "CAMISA"
    : Number(insc.doacao_valor || 0) > 0 ? "DOACAO"
    : "INSCRICAO";
  try {
    const cob = await criarECadastrarCobranca(env, insc.id, { cpf: cpfDigitos, nome: insc.nome, modalidade: "renovacao" }, residual, tipo);
    return json({ ok: true, id: insc.id, valor: residual, pagamento: cob, mensagem: "Novo Pix gerado." }, 201);
  } catch (e) {
    console.error("Erro renovar cobrança:", e);
    return json({ ok: false, mensagem: "Não conseguimos gerar o Pix." }, 502);
  }
}

async function handleVerificarCpf(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, mensagem: "JSON inválido" }, 400);
  }
  const cpf = normalizaCpf(body.cpf);
  if (!cpf || !validaCpf(cpf)) return json({ ok: false, mensagem: "CPF inválido." }, 400);

  const existente = await env.DB.prepare(
    "SELECT id, nome, quer_camiseta, tamanho_camiseta FROM inscricoes WHERE cpf = ? LIMIT 1"
  ).bind(cpf).first();

  if (!existente) return json({ ok: true, existe: false });

  const pendente = await buscarPagamentoPendente(env, existente.id);
  const inscCompleta = await env.DB.prepare(
    "SELECT id, quer_camiseta, doacao_valor FROM inscricoes WHERE id = ?"
  ).bind(existente.id).first();
  const { residual } = await calcularResidual(env, inscCompleta);

  return json({
    ok: true,
    existe: true,
    inscricao: {
      id: existente.id,
      nome: existente.nome,
      tem_camiseta: !!existente.quer_camiseta,
      tamanho_camiseta: existente.tamanho_camiseta,
    },
    pagamento_pendente: pendente,
    pode_renovar: !pendente && residual > 0,
    valor_residual: residual,
  });
}

async function handleComprarCamisa(request, env, inscricaoId) {
  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, mensagem: "JSON inválido" }, 400);
  }
  const tamanho = strOrNull(body.tamanho_camiseta, 20);
  if (!tamanho || !TAMANHOS.has(tamanho)) {
    return json({ ok: false, mensagem: "Tamanho inválido." }, 400);
  }
  const cpfDigitos = normalizaCpf(body.cpf);
  if (!cpfDigitos || cpfDigitos.length !== 11) {
    return json({ ok: false, mensagem: "Informe seu CPF." }, 400);
  }

  const insc = await env.DB.prepare(
    "SELECT id, nome, cpf, quer_camiseta FROM inscricoes WHERE id = ?"
  ).bind(inscricaoId).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  if (insc.cpf !== cpfDigitos) return json({ ok: false, mensagem: "CPF não confere com a inscrição." }, 403);

  // Primeira camisa: grava tamanho. Compras adicionais: mantém tamanho original
  // na inscrição (o pedido extra fica só na tabela pagamentos via txid).
  if (!insc.quer_camiseta) {
    await env.DB.prepare(
      "UPDATE inscricoes SET quer_camiseta = 1, tamanho_camiseta = ? WHERE id = ?"
    ).bind(tamanho, inscricaoId).run();
  }

  const valor = Number(env.CAMISA_VALOR || "40");
  const podeCobrar = env.SICREDI_MOCK === "1" || !!env.SICREDI;
  if (valor <= 0 || !podeCobrar || !env.SICREDI_CHAVE_PIX) {
    return json({ ok: true, id: inscricaoId, valor, mensagem: "Camiseta registrada." }, 201);
  }

  try {
    const cob = await criarECadastrarCobranca(env, inscricaoId, { cpf: cpfDigitos, nome: insc.nome, modalidade: "camisa" }, valor, "CAMISA");
    return json({ ok: true, id: inscricaoId, valor, pagamento: cob, mensagem: "Pague o Pix da camiseta." }, 201);
  } catch (e) {
    console.error("Erro cobrança camisa:", e);
    return json({ ok: true, id: inscricaoId, valor, mensagem: "Camiseta registrada. Pix indisponível agora." }, 201);
  }
}

function calcularValor(env, dados) {
  const base = Number(env.SICREDI_VALOR_INSCRICAO || 0);
  const doacao = Number(dados.doacao_valor || 0);
  const camisa = dados.quer_camiseta ? Number(env.CAMISA_VALOR || 40) : 0;
  const total =
    (Number.isFinite(base) ? base : 0) +
    (Number.isFinite(doacao) ? doacao : 0) +
    (Number.isFinite(camisa) ? camisa : 0);
  return Math.max(0, Math.round(total * 100) / 100);
}

async function criarECadastrarCobranca(env, inscricaoId, dados, valor, tipo = "INSCRICAO") {
  const txid = gerarTxid("LCCV");
  const rotulo = tipo === "CAMISA" ? "Camisa" : tipo === "DOACAO" ? "Doação" : tipo === "MISTO" ? "Inscrição + doação" : "Inscrição";
  const cob = await criarCobranca(env, {
    txid,
    valor,
    chavePix: env.SICREDI_CHAVE_PIX,
    cpf: dados.cpf,
    nome: dados.nome,
    solicitacao: `${rotulo} - Corrida Solidária`,
    expiracao: 48 * 60 * 60,
    infoAdicionais: [
      { nome: "Inscricao", valor: String(inscricaoId) },
      { nome: "Tipo", valor: tipo },
      { nome: "Modalidade", valor: String(dados.modalidade || "") },
    ],
  });

  const pixCopiaCola = cob.pixCopiaECola || null;
  const locationId = cob.loc?.id ? String(cob.loc.id) : null;

  await env.DB.prepare(`
    INSERT INTO pagamentos (txid, inscricao_id, valor, status, chave_pix, pix_copia_cola, location_id, tipo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(txid, inscricaoId, valor, cob.status || "ATIVA", env.SICREDI_CHAVE_PIX, pixCopiaCola, locationId, tipo).run();

  return { txid, valor, status: cob.status || "ATIVA", pixCopiaECola: pixCopiaCola, tipo };
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
    "SELECT txid, inscricao_id, valor, status, tipo, pix_copia_cola, pago_em, criado_em FROM pagamentos WHERE txid = ?"
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
  const { results } = await env.DB.prepare(`
    SELECT
      i.*,
      COALESCE(p.qtd_cobrancas, 0)  AS qtd_cobrancas,
      COALESCE(p.qtd_pagas, 0)      AS qtd_pagas,
      COALESCE(p.total_cobrado, 0)  AS total_cobrado,
      COALESCE(p.total_pago, 0)     AS total_pago,
      p.ultimo_pago_em              AS ultimo_pago_em
    FROM inscricoes i
    LEFT JOIN (
      SELECT
        inscricao_id,
        SUM(CASE WHEN status NOT LIKE 'REMOVIDA_%' THEN 1 ELSE 0 END)                       AS qtd_cobrancas,
        SUM(CASE WHEN status = 'CONCLUIDA' THEN 1 ELSE 0 END)                                AS qtd_pagas,
        SUM(CASE WHEN status NOT LIKE 'REMOVIDA_%' THEN valor ELSE 0 END)                    AS total_cobrado,
        SUM(CASE WHEN status = 'CONCLUIDA' THEN valor ELSE 0 END)                            AS total_pago,
        MAX(pago_em)                                                                          AS ultimo_pago_em
      FROM pagamentos
      GROUP BY inscricao_id
    ) p ON p.inscricao_id = i.id
    ORDER BY i.created_at DESC
    LIMIT 500
  `).all();
  return json({ ok: true, total: results.length, inscricoes: results });
}

async function handleDetalhe(request, env, id) {
  if (!autorizado(request, env)) return json({ ok: false, mensagem: "Não autorizado." }, 401);
  const insc = await env.DB.prepare("SELECT * FROM inscricoes WHERE id = ?").bind(id).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  const { results: pagamentos } = await env.DB.prepare(
    "SELECT txid, valor, status, tipo, chave_pix, pix_copia_cola, location_id, e2eid, pagador_nome, pagador_cpf, criado_em, pago_em FROM pagamentos WHERE inscricao_id = ? ORDER BY criado_em DESC"
  ).bind(id).all();
  return json({ ok: true, inscricao: insc, pagamentos });
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
    if (url.pathname === "/api/inscricao/verificar-cpf" && request.method === "POST") {
      return handleVerificarCpf(request, env);
    }
    if (url.pathname === "/api/inscricoes" && request.method === "GET") {
      return handleListar(request, env);
    }
    {
      const m = url.pathname.match(/^\/api\/inscricao\/(\d+)$/);
      if (m && request.method === "GET") return handleDetalhe(request, env, Number(m[1]));
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
    {
      const m = url.pathname.match(/^\/api\/inscricao\/(\d+)\/camisa$/);
      if (m && request.method === "POST") return handleComprarCamisa(request, env, Number(m[1]));
    }
    {
      const m = url.pathname.match(/^\/api\/inscricao\/(\d+)\/doacao$/);
      if (m && request.method === "POST") return handleDoacaoAvulsa(request, env, Number(m[1]));
    }
    {
      const m = url.pathname.match(/^\/api\/inscricao\/(\d+)\/renovar$/);
      if (m && request.method === "POST") return handleRenovarPagamento(request, env, Number(m[1]));
    }
    {
      const m = url.pathname.match(/^\/api\/inscricao\/(\d+)\/cancelar-pendente$/);
      if (m && request.method === "POST") return handleCancelarPendente(request, env, Number(m[1]));
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

    // "Em breve" opcional: só ativa se secret MOSTRAR_EM_BREVE=1.
    // Assets (img/, css, js) e API continuam funcionando normalmente.
    const oficial = url.hostname.endsWith("lccidadedovinho.com.br");
    const ehPagina = url.pathname === "/" || url.pathname === "/index.html";
    if (env.MOSTRAR_EM_BREVE === "1" && oficial && ehPagina && env.ASSETS) {
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
