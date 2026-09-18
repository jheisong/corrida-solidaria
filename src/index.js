/**
 * Corrida Solidária de Prevenção à Saúde
 * Lions Clube Bento Gonçalves Cidade do Vinho
 * Worker: rotas /api/* + assets estáticos em /public
 */

import { gerarTxid, criarCobranca, cadastrarWebhook, revisarCobrancaExpiracao } from "./sicredi.js";
import { enviarEregistrar, confirmacaoInscricao, pagamentoConfirmado, pagamentoPendente, ofertaCamisa, avisoGeral } from "./emails.js";

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
      equipe, quer_camiseta, contato_emergencia, aceite_termo, observacoes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    d.nome, d.email, d.telefone, d.cpf, d.data_nascimento, d.sexo || "", d.cidade || "", d.modalidade,
    d.equipe, d.quer_camiseta ? 1 : 0, d.contato_emergencia || "", 1, d.observacoes
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

function disparaConfirmacao(env, ctx, { inscricao_id, nome, email, cpf, categoria, quer_camiseta, tamanho_camiseta, doacao_valor, valor_total, pix_copia_cola }) {
  if (!ctx || !env.RESEND_API_KEY || !email) return;
  ctx.waitUntil((async () => {
    try {
      const tpl = await confirmacaoInscricao({
        nome,
        email,
        cpf,
        numero_inscricao: inscricao_id,
        categoria,
        quer_camiseta: !!quer_camiseta,
        tamanho_camiseta,
        valor_camiseta: quer_camiseta ? Number(env.CAMISA_VALOR || 40) : 0,
        valor_doacao: Number(doacao_valor || 0),
        valor_total: Number(valor_total || 0),
        pix_copia_cola,
      });
      await enviarEregistrar(env, {
        inscricao_id,
        tipo: "CONFIRMACAO",
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch (e) { console.error("Falha CONFIRMACAO", String(e?.message || e)); }
  })());
}

async function handleInscricao(request, env, ctx) {
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
    "SELECT id, nome, quer_camiseta FROM inscricoes WHERE cpf = ? LIMIT 1"
  ).bind(dados.cpf).first();
  if (existente) {
    const pendente = await buscarPagamentoPendente(env, existente.id);
    const { residual } = await calcularResidual(env, { id: existente.id });
    const primeiraCamisa = await env.DB.prepare(
      "SELECT tamanho FROM camisas WHERE inscricao_id = ? AND status IN ('PENDENTE','PAGO') ORDER BY criado_em LIMIT 1"
    ).bind(existente.id).first();
    return json({
      ok: false,
      cpf_duplicado: true,
      mensagem: "Atleta já cadastrado.",
      inscricao: {
        id: existente.id,
        nome: existente.nome,
        tem_camiseta: !!primeiraCamisa,
        tamanho_camiseta: primeiraCamisa?.tamanho || null,
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

  // Materializa camisa/doação nas tabelas próprias (N:1). Fica ATIVO
  // independente do pagamento — o total pago é agregado depois.
  if (dados.quer_camiseta && dados.tamanho_camiseta) {
    await env.DB.prepare(
      "INSERT INTO camisas (inscricao_id, tamanho, valor, status) VALUES (?, ?, ?, 'PENDENTE')"
    ).bind(id, dados.tamanho_camiseta, Number(env.CAMISA_VALOR || 40)).run();
  }
  if (Number(dados.doacao_valor || 0) > 0) {
    await env.DB.prepare(
      "INSERT INTO doacoes (inscricao_id, valor, status) VALUES (?, ?, 'PENDENTE')"
    ).bind(id, Number(dados.doacao_valor)).run();
  }

  const valor = calcularValor(env, dados);
  const podeCobrar = env.SICREDI_MOCK === "1" || !!env.SICREDI;
  if (valor <= 0 || !podeCobrar || !env.SICREDI_CHAVE_PIX) {
    disparaConfirmacao(env, ctx, {
      inscricao_id: id,
      nome: dados.nome, email: dados.email, cpf: dados.cpf,
      categoria: dados.modalidade,
      quer_camiseta: dados.quer_camiseta,
      tamanho_camiseta: dados.tamanho_camiseta,
      doacao_valor: dados.doacao_valor,
      valor_total: valor,
    });
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
    disparaConfirmacao(env, ctx, {
      inscricao_id: id,
      nome: dados.nome, email: dados.email, cpf: dados.cpf,
      categoria: dados.modalidade,
      quer_camiseta: dados.quer_camiseta,
      tamanho_camiseta: dados.tamanho_camiseta,
      doacao_valor: dados.doacao_valor,
      valor_total: valor,
      pix_copia_cola: cob?.pixCopiaECola,
    });
    return json({
      ok: true, id, valor,
      pagamento: cob,
      mensagem: "Inscrição registrada. Pague o Pix para confirmar.",
    }, 201);
  } catch (e) {
    console.error("Erro criar cobrança:", e);
    disparaConfirmacao(env, ctx, {
      inscricao_id: id,
      nome: dados.nome, email: dados.email, cpf: dados.cpf,
      categoria: dados.modalidade,
      quer_camiseta: dados.quer_camiseta,
      tamanho_camiseta: dados.tamanho_camiseta,
      doacao_valor: dados.doacao_valor,
      valor_total: valor,
    });
    return json({
      ok: true, id, valor,
      mensagem: "Inscrição registrada, mas não conseguimos gerar o Pix agora. Entraremos em contato.",
    }, 201);
  }
}

async function handleDoacaoAvulsa(request, env, inscricaoId, ctx) {
  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, mensagem: "JSON inválido" }, 400);
  }
  const cpfDigitos = normalizaCpf(body.cpf);
  const valor = Number(body.valor);
  if (!cpfDigitos || !validaCpf(cpfDigitos)) return json({ ok: false, mensagem: "CPF inválido." }, 400);
  if (!Number.isFinite(valor) || valor <= 0) return json({ ok: false, mensagem: "Valor inválido." }, 400);

  const insc = await env.DB.prepare("SELECT id, nome, email, cpf, modalidade FROM inscricoes WHERE id = ?").bind(inscricaoId).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  if (insc.cpf !== cpfDigitos) return json({ ok: false, mensagem: "CPF não confere com a inscrição." }, 403);

  const podeCobrar = env.SICREDI_MOCK === "1" || !!env.SICREDI;
  if (!podeCobrar || !env.SICREDI_CHAVE_PIX) {
    return json({ ok: false, mensagem: "Pix indisponível no momento." }, 503);
  }

  await env.DB.prepare(
    "INSERT INTO doacoes (inscricao_id, valor, status) VALUES (?, ?, 'PENDENTE')"
  ).bind(inscricaoId, Math.round(valor * 100) / 100).run();

  try {
    const cob = await regenerarCobrancaResidual(env, insc, cpfDigitos);
    const valorCob = cob?.valor || 0;
    disparaConfirmacao(env, ctx, {
      inscricao_id: inscricaoId, nome: insc.nome, email: insc.email, cpf: insc.cpf,
      categoria: insc.modalidade, quer_camiseta: false,
      doacao_valor: valor, valor_total: valorCob,
      pix_copia_cola: cob?.pixCopiaECola,
    });
    return json({ ok: true, id: inscricaoId, valor: valorCob, pagamento: cob, mensagem: "Pague o Pix da doação." }, 201);
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
  // Novo modelo: total devido = SUM(camisas ATIVO) + SUM(doacoes ATIVO).
  // Total pago = SUM(pagamentos CONCLUIDA). Base fica só como fallback
  // (env.SICREDI_VALOR_INSCRICAO) — normalmente 0.
  const base = Number(env.SICREDI_VALOR_INSCRICAO || 0);
  const [camisas, doacoes, pagos] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(valor),0) AS v FROM camisas WHERE inscricao_id = ? AND status IN ('PENDENTE','PAGO')").bind(insc.id).first(),
    env.DB.prepare("SELECT COALESCE(SUM(valor),0) AS v FROM doacoes WHERE inscricao_id = ? AND status IN ('PENDENTE','PAGO')").bind(insc.id).first(),
    env.DB.prepare("SELECT COALESCE(SUM(valor),0) AS v FROM pagamentos WHERE inscricao_id = ? AND status = 'CONCLUIDA'").bind(insc.id).first(),
  ]);
  const esperado = Math.round((base + Number(camisas?.v || 0) + Number(doacoes?.v || 0)) * 100) / 100;
  const pago = Math.round(Number(pagos?.v || 0) * 100) / 100;
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
  // Cancela todos os itens ativos (camisas e doações) da inscrição.
  await env.DB.prepare(
    "UPDATE camisas SET status = 'CANCELADO', cancelado_em = datetime('now') WHERE inscricao_id = ? AND status = 'PENDENTE'"
  ).bind(inscricaoId).run();
  await env.DB.prepare(
    "UPDATE doacoes SET status = 'CANCELADO', cancelado_em = datetime('now') WHERE inscricao_id = ? AND status = 'PENDENTE'"
  ).bind(inscricaoId).run();
  // Sincroniza flag rápida da inscrição.
  await env.DB.prepare(
    "UPDATE inscricoes SET quer_camiseta = 0 WHERE id = ?"
  ).bind(inscricaoId).run();

  if (patchErrors.length) console.error("Cancelar: falhas no PATCH Sicredi:", patchErrors);

  return json({
    ok: true,
    canceladas: res.meta?.changes ?? 0,
    mensagem: "Pedido cancelado.",
  });
}

/**
 * Invalida cobranças ATIVA (PATCH expiracao=1 no Sicredi + marca REMOVIDA
 * no D1) e cria uma nova cobrança pelo residual atual da inscrição.
 * Retorna a nova cobrança, ou null se não há residual.
 * Chama pelo handleComprarCamisa/handleDoacaoAvulsa/handleRenovarPagamento.
 */
async function regenerarCobrancaResidual(env, insc, cpfDigitos, reaproveitar = false) {
  const podeCobrar = env.SICREDI_MOCK === "1" || !!env.SICREDI;
  if (!podeCobrar || !env.SICREDI_CHAVE_PIX) throw new Error("Pix indisponível.");

  if (reaproveitar) {
    const pendenteAtivo = await buscarPagamentoPendente(env, insc.id);
    if (pendenteAtivo) return pendenteAtivo;
  }

  const { residual } = await calcularResidual(env, insc);
  if (residual <= 0) return null;

  const { results: antigas } = await env.DB.prepare(
    "SELECT txid FROM pagamentos WHERE inscricao_id = ? AND status = 'ATIVA'"
  ).bind(insc.id).all();
  for (const a of antigas || []) {
    try { await revisarCobrancaExpiracao(env, a.txid, 1); }
    catch (e) { console.error("Regenerar: PATCH falhou p/ txid", a.txid, String(e.message || e)); }
  }
  if (antigas && antigas.length) {
    await env.DB.prepare(
      "UPDATE pagamentos SET status = 'REMOVIDA_PELO_USUARIO_RECEBEDOR' WHERE inscricao_id = ? AND status = 'ATIVA'"
    ).bind(insc.id).run();
  }

  const [cam, don] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) n FROM camisas WHERE inscricao_id = ? AND status = 'PENDENTE'").bind(insc.id).first(),
    env.DB.prepare("SELECT COUNT(*) n FROM doacoes WHERE inscricao_id = ? AND status = 'PENDENTE'").bind(insc.id).first(),
  ]);
  const temCam = Number(cam?.n || 0) > 0;
  const temDon = Number(don?.n || 0) > 0;
  const tipo = temCam && temDon ? "MISTO" : temCam ? "CAMISA" : temDon ? "DOACAO" : "INSCRICAO";

  return await criarECadastrarCobranca(
    env, insc.id,
    { cpf: cpfDigitos, nome: insc.nome, modalidade: "renovacao" },
    residual, tipo
  );
}

async function handleRenovarPagamento(request, env, inscricaoId) {
  let body;
  try { body = await request.json(); } catch {
    return json({ ok: false, mensagem: "JSON inválido" }, 400);
  }
  const cpfDigitos = normalizaCpf(body.cpf);
  if (!cpfDigitos || !validaCpf(cpfDigitos)) return json({ ok: false, mensagem: "CPF inválido." }, 400);

  const insc = await env.DB.prepare(
    "SELECT id, nome, cpf FROM inscricoes WHERE id = ?"
  ).bind(inscricaoId).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  if (insc.cpf !== cpfDigitos) return json({ ok: false, mensagem: "CPF não confere com a inscrição." }, 403);

  try {
    const cob = await regenerarCobrancaResidual(env, insc, cpfDigitos, /*reaproveitar*/ true);
    if (!cob) return json({ ok: false, mensagem: "Não há valor pendente." }, 400);
    return json({ ok: true, id: insc.id, valor: cob.valor, pagamento: cob, mensagem: "Pix atualizado." }, 201);
  } catch (e) {
    console.error("Erro renovar cobrança:", e);
    return json({ ok: false, mensagem: String(e?.message || e) }, 502);
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
    "SELECT id, nome, quer_camiseta FROM inscricoes WHERE cpf = ? LIMIT 1"
  ).bind(cpf).first();

  if (!existente) return json({ ok: true, existe: false });

  const pendente = await buscarPagamentoPendente(env, existente.id);
  const { residual } = await calcularResidual(env, { id: existente.id });
  const primeiraCamisa = await env.DB.prepare(
    "SELECT tamanho FROM camisas WHERE inscricao_id = ? AND status IN ('PENDENTE','PAGO') ORDER BY criado_em LIMIT 1"
  ).bind(existente.id).first();

  return json({
    ok: true,
    existe: true,
    inscricao: {
      id: existente.id,
      nome: existente.nome,
      tem_camiseta: !!primeiraCamisa,
      tamanho_camiseta: primeiraCamisa?.tamanho || null,
    },
    pagamento_pendente: pendente,
    pode_renovar: !pendente && residual > 0,
    valor_residual: residual,
  });
}

async function handleComprarCamisa(request, env, inscricaoId, ctx) {
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
    "SELECT id, nome, email, cpf, modalidade, quer_camiseta FROM inscricoes WHERE id = ?"
  ).bind(inscricaoId).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  if (insc.cpf !== cpfDigitos) return json({ ok: false, mensagem: "CPF não confere com a inscrição." }, 403);

  // Cada compra vira uma linha própria em camisas (N:1 com inscricao).
  // Continua atualizando inscricoes.quer_camiseta/tamanho apenas na primeira
  // por retrocompat (filtros antigos ainda dependem).
  if (!insc.quer_camiseta) {
    await env.DB.prepare(
      "UPDATE inscricoes SET quer_camiseta = 1 WHERE id = ?"
    ).bind(inscricaoId).run();
  }
  await env.DB.prepare(
    "INSERT INTO camisas (inscricao_id, tamanho, valor, status) VALUES (?, ?, ?, 'PENDENTE')"
  ).bind(inscricaoId, tamanho, Number(env.CAMISA_VALOR || 40)).run();

  try {
    const cob = await regenerarCobrancaResidual(env, insc, cpfDigitos);
    const valor = cob?.valor || 0;
    disparaConfirmacao(env, ctx, {
      inscricao_id: inscricaoId, nome: insc.nome, email: insc.email, cpf: insc.cpf,
      categoria: insc.modalidade, quer_camiseta: true, tamanho_camiseta: tamanho,
      valor_total: valor,
      pix_copia_cola: cob?.pixCopiaECola,
    });
    return json({ ok: true, id: inscricaoId, valor, pagamento: cob, mensagem: "Pague o Pix da camiseta." }, 201);
  } catch (e) {
    console.error("Erro cobrança camisa:", e);
    return json({ ok: true, id: inscricaoId, mensagem: "Camiseta registrada. Pix indisponível agora." }, 201);
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

async function handleWebhookPix(request, env, ctx) {
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

    const existente = await env.DB.prepare(
      "SELECT txid, status, tipo, valor, inscricao_id FROM pagamentos WHERE txid = ?"
    ).bind(txid).first();
    if (!existente) {
      console.warn("Webhook Pix para txid desconhecido:", txid);
      continue;
    }

    const upd = await env.DB.prepare(`
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
      const cob = await env.DB.prepare("SELECT valor FROM pagamentos WHERE txid = ?").bind(txid).first();
      if (cob && valor + 0.001 < Number(cob.valor)) {
        console.warn("Pagamento com valor menor que cobrado", { txid, valor, cobrado: cob.valor });
      }
    }

    // Dispara CONFIRMADO só se acabamos de marcar (era diferente de CONCLUIDA)
    // e a atualização de fato tocou 1 linha (idempotência do webhook).
    if (upd.meta?.changes && existente.status !== "CONCLUIDA") {
      // Se o total pago já cobre o total devido ativo, marca camisas e
      // doações PENDENTE como PAGO. Se pagou parcial, mantém PENDENTE.
      const inscBase = { id: existente.inscricao_id };
      const { esperado, pago } = await calcularResidual(env, inscBase);
      if (esperado > 0 && pago >= esperado) {
        await env.DB.prepare(
          "UPDATE camisas SET status = 'PAGO' WHERE inscricao_id = ? AND status = 'PENDENTE'"
        ).bind(existente.inscricao_id).run();
        await env.DB.prepare(
          "UPDATE doacoes SET status = 'PAGO' WHERE inscricao_id = ? AND status = 'PENDENTE'"
        ).bind(existente.inscricao_id).run();
      }
      const insc = await env.DB.prepare(
        "SELECT id, nome, email FROM inscricoes WHERE id = ?"
      ).bind(existente.inscricao_id).first();
      if (insc?.email && ctx) {
        const tpl = pagamentoConfirmado({
          nome: insc.nome,
          numero_inscricao: insc.id,
          tipo: existente.tipo || "INSCRICAO",
          valor_pago: Number.isFinite(valor) ? valor : Number(existente.valor),
          e2eid,
          data_pagamento: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        });
        ctx.waitUntil(
          enviarEregistrar(env, {
            inscricao_id: insc.id,
            tipo: "CONFIRMADO",
            to: insc.email,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
          }).catch((e) => console.error("Falha CONFIRMADO", String(e?.message || e)))
        );
      }

      // Alerta interno: pagamento entrou depois do cancelamento.
      if (existente.status === "REMOVIDA_PELO_USUARIO_RECEBEDOR" && ctx) {
        ctx.waitUntil(
          enviarEregistrar(env, {
            inscricao_id: existente.inscricao_id,
            tipo: "ALERTA_INTERNO",
            to: "lionsclubebgcidadedovinho@gmail.com",
            subject: `[Atenção] Pagamento após cancelamento — inscrição #${existente.inscricao_id}`,
            html: `<p>Pagamento recebido em cobrança já cancelada pelo usuário.</p>
                   <ul>
                     <li>Inscrição: #${existente.inscricao_id}</li>
                     <li>txid: ${txid}</li>
                     <li>e2eid: ${e2eid || "-"}</li>
                     <li>valor: R$ ${Number(valor || existente.valor).toFixed(2)}</li>
                   </ul>
                   <p>Necessária ação manual: reativar camisa/doação OU fazer devolução via API Sicredi.</p>`,
            text: `Pagamento após cancelamento. Inscrição #${existente.inscricao_id}, txid ${txid}, e2eid ${e2eid || "-"}, valor R$ ${Number(valor || existente.valor).toFixed(2)}. Ação manual necessária.`,
          }).catch((e) => console.error("Falha ALERTA_INTERNO", String(e?.message || e)))
        );
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

async function handleDevPagar(request, env, txid, ctx) {
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
  return handleWebhookPix(req, env, ctx);
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
      p.ultimo_pago_em              AS ultimo_pago_em,
      COALESCE(cam.qtd_camisas, 0)  AS qtd_camisas,
      COALESCE(cam.tamanhos, '')    AS tamanhos_camisa,
      COALESCE(don.doacao_total, 0) AS doacao_total
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
    LEFT JOIN (
      SELECT inscricao_id, COUNT(*) AS qtd_camisas, GROUP_CONCAT(tamanho, ', ') AS tamanhos
        FROM camisas WHERE status IN ('PENDENTE','PAGO')
       GROUP BY inscricao_id
    ) cam ON cam.inscricao_id = i.id
    LEFT JOIN (
      SELECT inscricao_id, SUM(valor) AS doacao_total
        FROM doacoes WHERE status IN ('PENDENTE','PAGO')
       GROUP BY inscricao_id
    ) don ON don.inscricao_id = i.id
    ORDER BY i.created_at DESC
    LIMIT 500
  `).all();
  return json({ ok: true, total: results.length, inscricoes: results });
}

// -------- painel: gestão de e-mails --------------------------------------

const FILTROS_EMAIL = new Set([
  "todos", "pendentes", "pendentes_sem_email", "pendentes_email_antigo_48h",
  "sem_camisa", "sem_camisa_sem_oferta", "pagos_confirmados",
]);
const TIPOS_EMAIL_MANUAL = new Set(["CONFIRMACAO", "PENDENTE", "OFERTA_CAMISA", "AVISO_GERAL"]);

async function listarAtletasParaEmail(env, filtro) {
  const { results } = await env.DB.prepare(`
    SELECT
      i.id, i.nome, i.email, i.cpf, i.modalidade, i.created_at,
      COALESCE(pagos.total_pago, 0)   AS total_pago,
      COALESCE(cam.total, 0)          AS total_camisas,
      COALESCE(cam.qtd, 0)            AS qtd_camisas,
      COALESCE(cam.tamanhos, '')      AS tamanhos_camisa,
      COALESCE(don.total, 0)          AS total_doacoes,
      (SELECT MAX(criado_em) FROM emails_enviados e
        WHERE e.inscricao_id = i.id AND e.tipo = 'PENDENTE')       AS ultimo_pendente_em,
      (SELECT MAX(criado_em) FROM emails_enviados e
        WHERE e.inscricao_id = i.id AND e.tipo = 'OFERTA_CAMISA')  AS ultimo_oferta_em
    FROM inscricoes i
    LEFT JOIN (
      SELECT inscricao_id,
             SUM(CASE WHEN status = 'CONCLUIDA' THEN valor ELSE 0 END) AS total_pago
        FROM pagamentos GROUP BY inscricao_id
    ) pagos ON pagos.inscricao_id = i.id
    LEFT JOIN (
      SELECT inscricao_id, COUNT(*) AS qtd, SUM(valor) AS total,
             GROUP_CONCAT(tamanho, ', ') AS tamanhos
        FROM camisas WHERE status IN ('PENDENTE','PAGO')
       GROUP BY inscricao_id
    ) cam ON cam.inscricao_id = i.id
    LEFT JOIN (
      SELECT inscricao_id, SUM(valor) AS total
        FROM doacoes WHERE status IN ('PENDENTE','PAGO')
       GROUP BY inscricao_id
    ) don ON don.inscricao_id = i.id
    WHERE i.email IS NOT NULL AND i.email <> ''
      AND i.email_invalido = 0 AND i.email_complained = 0
    ORDER BY i.created_at DESC
  `).all();

  const base = Number(env.SICREDI_VALOR_INSCRICAO || 0);
  const agora = Date.now();
  const _48hAtras = agora - 48 * 60 * 60 * 1000;

  const enriquecidos = (results || []).map((r) => {
    const esperado = Math.round((base + Number(r.total_camisas || 0) + Number(r.total_doacoes || 0)) * 100) / 100;
    const pago = Math.round(Number(r.total_pago || 0) * 100) / 100;
    const residual = Math.max(0, Math.round((esperado - pago) * 100) / 100);
    return {
      id: r.id,
      nome: r.nome,
      email: r.email,
      cpf: r.cpf,
      modalidade: r.modalidade,
      quer_camiseta: Number(r.qtd_camisas) > 0,
      tamanho_camiseta: r.tamanhos_camisa || null,
      doacao_valor: Number(r.total_doacoes || 0),
      valor_esperado: esperado,
      valor_pago: pago,
      valor_residual: residual,
      ultimo_pendente_em: r.ultimo_pendente_em,
      ultimo_oferta_em: r.ultimo_oferta_em,
      created_at: r.created_at,
    };
  });

  return enriquecidos.filter((r) => {
    switch (filtro) {
      case "todos": return true;
      case "pendentes": return r.valor_residual > 0;
      case "pendentes_sem_email": return r.valor_residual > 0 && !r.ultimo_pendente_em;
      case "pendentes_email_antigo_48h":
        return r.valor_residual > 0 && r.ultimo_pendente_em &&
          new Date(r.ultimo_pendente_em.replace(" ", "T") + "Z").getTime() < _48hAtras;
      case "sem_camisa": return !r.quer_camiseta;
      case "sem_camisa_sem_oferta": return !r.quer_camiseta && !r.ultimo_oferta_em;
      case "pagos_confirmados":
        return r.valor_esperado > 0 && r.valor_residual === 0;
      default: return true;
    }
  });
}

async function cotaHoje(env) {
  const limite = Number(env.EMAIL_LIMITE_DIARIO || 100);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) n FROM emails_enviados WHERE status = 'ENVIADO' AND date(criado_em) = date('now')"
  ).first();
  const usado = Number(row?.n || 0);
  return { limite, usado, restante: Math.max(0, limite - usado) };
}

async function handleListarEmails(request, env) {
  if (!autorizado(request, env)) return json({ ok: false, mensagem: "Não autorizado." }, 401);
  let body; try { body = await request.json(); } catch { body = {}; }
  const filtro = String(body.filtro || "todos");
  if (!FILTROS_EMAIL.has(filtro)) return json({ ok: false, mensagem: "Filtro inválido." }, 400);
  const atletas = await listarAtletasParaEmail(env, filtro);
  const cota = await cotaHoje(env);
  return json({ ok: true, filtro, total: atletas.length, atletas, cota });
}

async function handleEnviarEmails(request, env, ctx) {
  if (!autorizado(request, env)) return json({ ok: false, mensagem: "Não autorizado." }, 401);
  let body; try { body = await request.json(); } catch { body = {}; }
  const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
  const tipo = String(body.tipo || "");
  if (!ids.length) return json({ ok: false, mensagem: "Selecione ao menos um atleta." }, 400);
  if (!TIPOS_EMAIL_MANUAL.has(tipo)) return json({ ok: false, mensagem: "Tipo inválido." }, 400);

  const extraAssunto = String(body.extra?.assunto || "").slice(0, 200);
  const extraCorpo = String(body.extra?.corpo_html || "").slice(0, 30000);
  if (tipo === "AVISO_GERAL" && (!extraAssunto || !extraCorpo)) {
    return json({ ok: false, mensagem: "AVISO_GERAL requer assunto e corpo_html." }, 400);
  }

  // Carrega os atletas selecionados (sem filtro adicional — o operador escolheu na UI).
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`
    SELECT i.id, i.nome, i.email, i.cpf, i.modalidade,
           COALESCE(pagos.total_pago, 0)   AS total_pago,
           COALESCE(cam.total, 0)          AS total_camisas,
           COALESCE(cam.qtd, 0)            AS qtd_camisas,
           COALESCE(cam.tamanhos, '')      AS tamanhos_camisa,
           COALESCE(don.total, 0)          AS total_doacoes
      FROM inscricoes i
      LEFT JOIN (SELECT inscricao_id, SUM(CASE WHEN status='CONCLUIDA' THEN valor ELSE 0 END) AS total_pago FROM pagamentos GROUP BY inscricao_id) pagos ON pagos.inscricao_id = i.id
      LEFT JOIN (SELECT inscricao_id, COUNT(*) AS qtd, SUM(valor) AS total, GROUP_CONCAT(tamanho, ', ') AS tamanhos FROM camisas WHERE status IN ('PENDENTE','PAGO') GROUP BY inscricao_id) cam ON cam.inscricao_id = i.id
      LEFT JOIN (SELECT inscricao_id, SUM(valor) AS total FROM doacoes WHERE status IN ('PENDENTE','PAGO') GROUP BY inscricao_id) don ON don.inscricao_id = i.id
     WHERE i.id IN (${placeholders})
       AND i.email IS NOT NULL AND i.email <> ''
       AND i.email_invalido = 0 AND i.email_complained = 0
  `).bind(...ids).all();

  const base = Number(env.SICREDI_VALOR_INSCRICAO || 0);
  const camisaVal = Number(env.CAMISA_VALOR || 40);

  const cota = await cotaHoje(env);
  let restante = cota.restante;
  const resumo = { total: results.length, enviados: 0, falhou: 0, ignorados_cota: 0, detalhes: [] };

  for (const r of results) {
    if (restante <= 0) {
      resumo.ignorados_cota++;
      resumo.detalhes.push({ id: r.id, status: "IGNORADO_COTA" });
      continue;
    }
    const totalCamisas = Number(r.total_camisas || 0);
    const totalDoacoes = Number(r.total_doacoes || 0);
    const esperado = Math.round((base + totalCamisas + totalDoacoes) * 100) / 100;
    const pago = Math.round(Number(r.total_pago || 0) * 100) / 100;
    const residual = Math.max(0, Math.round((esperado - pago) * 100) / 100);

    let tpl;
    try {
      if (tipo === "CONFIRMACAO") {
        tpl = await confirmacaoInscricao({
          nome: r.nome, cpf: r.cpf, numero_inscricao: r.id, categoria: r.modalidade,
          quer_camiseta: Number(r.qtd_camisas) > 0,
          tamanho_camiseta: r.tamanhos_camisa || null,
          valor_camiseta: totalCamisas,
          valor_doacao: totalDoacoes,
          valor_total: residual,   // 0 se já quitou → template vira "confirmada sem pendência"
        });
      } else if (tipo === "PENDENTE") {
        tpl = pagamentoPendente({
          nome: r.nome, cpf: r.cpf, numero_inscricao: r.id, categoria: r.modalidade,
          valor_residual: residual,
          quer_camiseta: Number(r.qtd_camisas) > 0, tamanho_camiseta: r.tamanhos_camisa || null,
          valor_camiseta: totalCamisas, valor_doacao: totalDoacoes,
        });
      } else if (tipo === "OFERTA_CAMISA") {
        tpl = ofertaCamisa({
          nome: r.nome, cpf: r.cpf, numero_inscricao: r.id, categoria: r.modalidade,
          valor_camiseta: camisaVal,
        });
      } else if (tipo === "AVISO_GERAL") {
        tpl = avisoGeral({
          nome: r.nome, categoria: r.modalidade,
          assunto: extraAssunto, corpo_html: extraCorpo,
        });
      }
    } catch (e) {
      resumo.falhou++;
      resumo.detalhes.push({ id: r.id, status: "TEMPLATE_ERRO", erro: String(e?.message || e) });
      continue;
    }

    const res = await enviarEregistrar(env, {
      inscricao_id: r.id,
      tipo,
      to: r.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    if (res.ok) {
      resumo.enviados++;
      restante--;
      resumo.detalhes.push({ id: r.id, status: "ENVIADO" });
    } else {
      resumo.falhou++;
      resumo.detalhes.push({ id: r.id, status: "FALHOU", motivo: res.motivo });
    }
  }

  return json({ ok: true, tipo, ...resumo, cota_restante: restante });
}

async function handleDetalhe(request, env, id) {
  if (!autorizado(request, env)) return json({ ok: false, mensagem: "Não autorizado." }, 401);
  const insc = await env.DB.prepare("SELECT * FROM inscricoes WHERE id = ?").bind(id).first();
  if (!insc) return json({ ok: false, mensagem: "Inscrição não encontrada." }, 404);
  const [pagamentos, camisas, doacoes, resumo] = await Promise.all([
    env.DB.prepare(
      "SELECT txid, valor, status, tipo, chave_pix, pix_copia_cola, location_id, e2eid, pagador_nome, pagador_cpf, criado_em, pago_em FROM pagamentos WHERE inscricao_id = ? ORDER BY criado_em DESC"
    ).bind(id).all(),
    env.DB.prepare(
      "SELECT id, tamanho, valor, status, criado_em, cancelado_em FROM camisas WHERE inscricao_id = ? ORDER BY criado_em"
    ).bind(id).all(),
    env.DB.prepare(
      "SELECT id, valor, status, criado_em, cancelado_em FROM doacoes WHERE inscricao_id = ? ORDER BY criado_em"
    ).bind(id).all(),
    calcularResidual(env, insc),
  ]);
  return json({
    ok: true,
    inscricao: insc,
    pagamentos: pagamentos.results,
    camisas: camisas.results,
    doacoes: doacoes.results,
    resumo,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/inscricao" && request.method === "POST") {
      return handleInscricao(request, env, ctx);
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
      return handleWebhookPix(request, env, ctx);
    }
    if (url.pathname === "/api/webhook/pix/cadastrar" && request.method === "POST") {
      return handleCadastrarWebhook(request, env);
    }
    if (url.pathname === "/api/painel/emails/listar" && request.method === "POST") {
      return handleListarEmails(request, env);
    }
    if (url.pathname === "/api/painel/emails/enviar" && request.method === "POST") {
      return handleEnviarEmails(request, env, ctx);
    }
    {
      const m = url.pathname.match(/^\/api\/pagamento\/([A-Za-z0-9]{26,35})$/);
      if (m && request.method === "GET") return handlePagamentoStatus(request, env, m[1]);
    }
    {
      const m = url.pathname.match(/^\/api\/inscricao\/(\d+)\/camisa$/);
      if (m && request.method === "POST") return handleComprarCamisa(request, env, Number(m[1]), ctx);
    }
    {
      const m = url.pathname.match(/^\/api\/inscricao\/(\d+)\/doacao$/);
      if (m && request.method === "POST") return handleDoacaoAvulsa(request, env, Number(m[1]), ctx);
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
      if (m && request.method === "POST") return handleDevPagar(request, env, m[1], ctx);
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
