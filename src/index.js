/**
 * Corrida Solidária de Prevenção à Saúde
 * Lions Clube Bento Gonçalves Cidade do Vinho
 * Worker: rotas /api/* + assets estáticos em /public
 */

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

  try {
    const id = await inserirInscricao(env, dados);
    return json({
      ok: true,
      id,
      mensagem: "Inscrição registrada com sucesso! Você receberá a confirmação por e-mail.",
    }, 201);
  } catch (e) {
    console.error("Erro inserir inscrição:", e);
    return json({ ok: false, mensagem: "Não foi possível registrar sua inscrição. Tente novamente em instantes." }, 500);
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
