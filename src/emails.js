/**
 * E-mail transacional via Resend.
 * Documentação: docs/EMAIL.md · Exemplos renderizados: docs/EMAIL_TEMPLATES.md.
 */

import QRCode from "qrcode";

const ORGANIZADOR = "Lions Clube Bento Gonçalves — Cidade do Vinho";
const EMAIL_CONTATO = "lionsclubebgcidadedovinho@gmail.com";
const EVENTO = "Treino Solidário Contra o Diabetes";
const DATA_EVENTO = "08/11/2026";
const LOCAL_EVENTO = "Pista Atlética Municipal — Bento Gonçalves/RS";
const CIDADE_UF = "Bento Gonçalves/RS";
const LINK_SITE = "https://treinosolidario.lccidadedovinho.com.br";

const COR_PRIMARIA = "#16357F";
const COR_DESTAQUE = "#F5A800";
const COR_SUCESSO_BG = "#E7F6EC";
const COR_SUCESSO_FG = "#1E8A46";
const COR_AMBAR_BG = "#FFF6E3";
const COR_AMBAR_FG = "#B57100";
const COR_AMBAR_TEXTO = "#7A5600";
const COR_TEXTO = "#33415E";
const COR_SUAVE = "#6B7A99";
const COR_BORDA = "#EDF1F9";
const COR_FUNDO = "#F6F8FC";

const LEMBRETE_ALIMENTO =
  "Se puder, leve 1 kg de alimento não perecível no dia — a doação é voluntária e ajuda famílias da nossa comunidade. 💛";

// -------- envio bruto ----------------------------------------------------

export async function sendEmail(env, { to, subject, html, text, replyTo }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada.");
  if (!env.RESEND_FROM_EMAIL) throw new Error("RESEND_FROM_EMAIL não configurado.");
  if (env.EMAIL_DRY_RUN === "1") {
    console.log("EMAIL_DRY_RUN", { to, subject, snippet: (text || "").slice(0, 120) });
    return { id: "dry-run-" + Date.now() };
  }
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
  try { json = t ? JSON.parse(t) : null; } catch { /* ignora */ }
  if (!r.ok) throw new Error(`Resend ${r.status}: ${t.slice(0, 500)}`);
  return json;
}

// -------- envio + gravação ----------------------------------------------

export async function enviarEregistrar(env, { inscricao_id, tipo, to, subject, html, text, replyTo }) {
  const queimado = await env.DB.prepare(
    "SELECT 1 FROM inscricoes WHERE email = ? AND (email_invalido = 1 OR email_complained = 1) LIMIT 1"
  ).bind(to).first();
  if (queimado) {
    await env.DB.prepare(
      `INSERT INTO emails_enviados (inscricao_id, tipo, destinatario, assunto, status, ultimo_erro)
       VALUES (?, ?, ?, ?, 'BLOQUEADO', 'endereço marcado como inválido ou reclamado')`
    ).bind(inscricao_id, tipo, to, subject).run();
    return { ok: false, motivo: "endereço queimado" };
  }
  try {
    const r = await sendEmail(env, { to, subject, html, text, replyTo });
    await env.DB.prepare(
      `INSERT INTO emails_enviados (inscricao_id, tipo, destinatario, assunto, resend_id, status)
       VALUES (?, ?, ?, ?, ?, 'ENVIADO')`
    ).bind(inscricao_id, tipo, to, subject, r?.id || null).run();
    return { ok: true, resend_id: r?.id || null };
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 500);
    console.error("Erro sendEmail", { tipo, to, msg });
    await env.DB.prepare(
      `INSERT INTO emails_enviados (inscricao_id, tipo, destinatario, assunto, status, ultimo_erro)
       VALUES (?, ?, ?, ?, 'FALHOU', ?)`
    ).bind(inscricao_id, tipo, to, subject, msg).run();
    return { ok: false, motivo: msg };
  }
}

// -------- helpers -------------------------------------------------------

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function brl(v) {
  const n = Number(v || 0);
  return "R$ " + n.toFixed(2).replace(".", ",");
}
function primeiroNome(s) {
  return (s || "").trim().split(/\s+/)[0] || "Atleta";
}
function labelModalidade(m) {
  return ({
    "corrida-5km": "Corrida 5 km",
    "caminhada-5km": "Caminhada 5 km",
    "kids-250m": "Corrida Kids · 250 m",
  })[m] || (m || "-");
}
function cpfDigits(cpf) {
  return String(cpf || "").replace(/\D/g, "");
}
function deepLinkRetomar(cpf) {
  return `${LINK_SITE}/#retomar?cpf=${encodeURIComponent(cpfDigits(cpf))}`;
}
function rotuloReferente(tipo) {
  return ({
    INSCRICAO: "Inscrição",
    CAMISA: "Camisa oficial",
    DOACAO: "Doação solidária",
    MISTO: "Camisa oficial + doação",
  })[tipo] || "Pagamento";
}

// Blocos padronizados
const blocoVolteAoSite = `<p style="margin:14px 0 0;font-size:13px;color:${COR_SUAVE};line-height:1.55;">Camisa, doação ou ajustes na inscrição: entre no site <a href="${LINK_SITE}/" style="color:${COR_PRIMARIA};font-weight:700;">${LINK_SITE.replace(/^https?:\/\//, "")}</a> e informe seu CPF no formulário de inscrição.</p>`;

const blocoAlimento = `<div style="margin-top:16px;background:${COR_AMBAR_BG};border:1px solid ${COR_AMBAR_FG}44;border-radius:10px;padding:12px 14px;color:${COR_AMBAR_TEXTO};font-size:13px;line-height:1.55;">${esc(LEMBRETE_ALIMENTO)}</div>`;

function tabelaKV(linhas) {
  const rows = linhas.filter(Boolean).map(([k, v, extra]) => {
    const kStyle = `padding:8px 0;border-bottom:1px solid ${COR_BORDA};font-size:14px;color:${COR_SUAVE};`;
    const vStyle = `padding:8px 0;border-bottom:1px solid ${COR_BORDA};font-size:14px;color:${extra?.corValor || COR_PRIMARIA};font-weight:700;text-align:right;`;
    return `<tr><td style="${kStyle}">${k}</td><td style="${vStyle}">${v}</td></tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COR_BORDA};border-radius:10px;padding:8px 16px;background:${COR_FUNDO};">${rows}</table>`;
}

/**
 * Layout base. Aceita:
 * - titulo, preheader
 * - selo: "sucesso" (adiciona ✓ no topo do corpo)
 * - blocos: array de HTML strings
 * - ctaTexto, ctaHref
 */
function layout({ titulo, blocos, ctaTexto, ctaHref, preheader, selo }) {
  const selHtml = selo === "sucesso"
    ? `<div align="center" style="margin:0 0 12px;">
         <span style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:${COR_SUCESSO_BG};color:${COR_SUCESSO_FG};font-size:28px;font-weight:800;">✓</span>
       </div>`
    : "";
  const cta = ctaTexto && ctaHref
    ? `<tr><td align="center" style="padding:24px 0 8px;">
         <a href="${esc(ctaHref)}" style="background:${COR_DESTAQUE};color:${COR_PRIMARIA};text-decoration:none;font-family:Arial,sans-serif;font-weight:800;font-size:16px;padding:14px 28px;border-radius:10px;display:inline-block;text-transform:uppercase;letter-spacing:0.04em;">${esc(ctaTexto)}</a>
       </td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:${COR_FUNDO};font-family:Arial,Helvetica,sans-serif;color:${COR_TEXTO};">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">${esc(preheader || titulo)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR_FUNDO};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${COR_PRIMARIA};color:#FFFFFF;padding:22px 28px;">
        <div style="font-family:Arial,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;font-size:20px;">Treino Solidário</div>
        <div style="font-size:13px;color:#C9D6F0;margin-top:2px;">${esc(EVENTO)} · ${esc(DATA_EVENTO)} · ${esc(CIDADE_UF)}</div>
      </td></tr>
      <tr><td style="padding:28px;">
        ${selHtml}
        <h1 style="margin:0 0 16px;color:${COR_PRIMARIA};font-family:Arial,sans-serif;font-size:22px;">${titulo}</h1>
        ${blocos.join("\n")}
      </td></tr>
      ${cta}
      <tr><td style="padding:20px 28px 28px;font-size:12px;color:${COR_SUAVE};line-height:1.55;">
        ${blocoVolteAoSite}
        <p style="margin:10px 0 0;font-size:12px;color:${COR_SUAVE};">Dúvidas? Responda este e-mail ou escreva para <a href="mailto:${EMAIL_CONTATO}" style="color:${COR_PRIMARIA};font-weight:700;">${EMAIL_CONTATO}</a>.</p>
      </td></tr>
    </table>
    <div style="max-width:600px;margin:16px auto 0;font-size:11px;color:#8A97B0;text-align:center;line-height:1.5;">
      ${esc(ORGANIZADOR)} · ${esc(LOCAL_EVENTO)}<br>
      <a href="${LINK_SITE}" style="color:#8A97B0;">${LINK_SITE}</a>
    </div>
  </td></tr>
</table>
</body></html>`;
}

// -------- template: CONFIRMACAO -----------------------------------------

/**
 * dados: {
 *   nome, email, cpf,
 *   numero_inscricao, categoria,
 *   quer_camiseta, tamanho_camiseta, valor_camiseta,
 *   valor_doacao, valor_total,
 *   pix_copia_cola?  // opcional — se vier, mostra card com QR gerado externamente
 * }
 */
async function gerarQrDataUrl(texto) {
  try {
    return await QRCode.toDataURL(texto, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
      color: { dark: "#16357F", light: "#FFFFFFFF" },
    });
  } catch (e) {
    console.error("Falha gerar QR", String(e?.message || e));
    return null;
  }
}

export async function confirmacaoInscricao(dados) {
  const nome = primeiroNome(dados.nome);
  const modalidade = labelModalidade(dados.categoria);
  const temPag = Number(dados.valor_total || 0) > 0;
  const linkRetomar = deepLinkRetomar(dados.cpf);

  const tabela = tabelaKV([
    ["Nº de inscrição", `#${esc(dados.numero_inscricao)}`],
    ["Modalidade", esc(modalidade)],
    dados.quer_camiseta
      ? ["Camiseta", `Tamanho ${esc(dados.tamanho_camiseta || "?")} · ${brl(dados.valor_camiseta || 40)}`]
      : null,
    Number(dados.valor_doacao || 0) > 0
      ? ["Doação solidária", brl(dados.valor_doacao)]
      : null,
    temPag
      ? ["Valor da sua contribuição", brl(dados.valor_total), { corValor: COR_AMBAR_FG }]
      : ["Inscrição", "Gratuita", { corValor: COR_SUCESSO_FG }],
  ]);

  if (temPag) {
    // 1a — com camisa/doação a confirmar
    const explicacao = dados.quer_camiseta && Number(dados.valor_doacao || 0) > 0
      ? "Você já solicitou a camisa oficial e ainda contribuiu com uma doação para a causa — muito obrigado! 💙"
      : dados.quer_camiseta
        ? "Você já solicitou a camisa oficial — muito obrigado por contribuir com a causa! 💙"
        : "Você já contribuiu com uma doação para a causa — muito obrigado! 💛";

    const blocos = [
      `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Que alegria ter você com a gente no <strong>${esc(EVENTO)}</strong>, <strong style="color:${COR_PRIMARIA};">${esc(nome)}</strong>. Sua vaga está garantida — sem custo nenhum.</p>`,
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Nos vemos na largada em <strong>${esc(DATA_EVENTO)}</strong>, na ${esc(LOCAL_EVENTO)}.</p>`,
      tabela,
      `<p style="margin:16px 0 0;font-size:14px;color:${COR_TEXTO};line-height:1.55;">${explicacao} Para finalizar, clique no botão abaixo — o site abre com o QR Code e o copia-e-cola prontos, já com seu CPF preenchido. Se o Pix expirar, geramos um novo automaticamente.</p>`,
      blocoAlimento,
    ];

    return {
      subject: "Inscrição confirmada — falta só o Pix da sua camisa 🧡",
      html: layout({
        titulo: `Sua inscrição está confirmada, ${esc(nome)}! 🎉`,
        preheader: `Sua vaga está garantida. Confirme o Pix de ${brl(dados.valor_total)} da camisa/doação.`,
        blocos,
        ctaTexto: "Abrir Pix agora",
        ctaHref: linkRetomar,
      }),
      text: [
        `Olá, ${nome}!`,
        ``,
        `Sua inscrição no ${EVENTO} está confirmada — vaga garantida, sem custo.`,
        `Data: ${DATA_EVENTO} — ${LOCAL_EVENTO}`,
        ``,
        `Nº de inscrição: #${dados.numero_inscricao}`,
        `Modalidade: ${modalidade}`,
        dados.quer_camiseta ? `Camiseta: tamanho ${dados.tamanho_camiseta} — ${brl(dados.valor_camiseta || 40)}` : null,
        Number(dados.valor_doacao || 0) > 0 ? `Doação solidária: ${brl(dados.valor_doacao)}` : null,
        `Valor da sua contribuição: ${brl(dados.valor_total)}`,
        ``,
        `Pague pelo Pix — o site abre com QR e copia-e-cola prontos (e gera novo se expirar):`,
        linkRetomar,
        ``,
        LEMBRETE_ALIMENTO,
        ``,
        `Camisa, doação ou ajustes: ${LINK_SITE}/ (informe seu CPF no formulário).`,
        `Dúvidas? ${EMAIL_CONTATO}`,
        `— ${ORGANIZADOR}`,
      ].filter((x) => x !== null).join("\n"),
    };
  }

  // 1b — gratuita
  const blocos = [
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Que alegria ter você com a gente no <strong>${esc(EVENTO)}</strong>, <strong style="color:${COR_PRIMARIA};">${esc(nome)}</strong>. Sua vaga está garantida — sem custo nenhum.</p>`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Nos vemos na largada em <strong>${esc(DATA_EVENTO)}</strong>, na ${esc(LOCAL_EVENTO)}.</p>`,
    tabela,
    blocoAlimento,
    `<p style="margin:16px 0 0;font-size:14px;color:${COR_TEXTO};line-height:1.55;">Ah, e você ainda pode <strong>adquirir a camisa oficial</strong> ou <strong>fazer uma doação</strong> para ajudar na causa: é só voltar ao site, entrar no formulário de inscrição e informar seu CPF — as opções aparecem pra você. 😉</p>`,
    `<p style="margin:12px 0 0;font-size:13px;color:${COR_SUAVE};">Retirada de pulseiras a partir das 07h00 · Largada da caminhada às 08h30.</p>`,
  ];

  return {
    subject: "Inscrição confirmada — Treino Solidário",
    html: layout({
      titulo: `Sua inscrição está confirmada, ${esc(nome)}! 🎉`,
      preheader: `Sua vaga está garantida, sem custo. Nos vemos em ${DATA_EVENTO}!`,
      blocos,
      ctaTexto: "Quero a camisa / doar",
      ctaHref: linkRetomar,
    }),
    text: [
      `Olá, ${nome}!`,
      ``,
      `Sua inscrição no ${EVENTO} está confirmada — vaga garantida, sem custo.`,
      `Data: ${DATA_EVENTO} — ${LOCAL_EVENTO}`,
      ``,
      `Nº de inscrição: #${dados.numero_inscricao}`,
      `Modalidade: ${modalidade}`,
      `Inscrição gratuita.`,
      ``,
      LEMBRETE_ALIMENTO,
      ``,
      `Quer adquirir a camisa oficial ou fazer uma doação? Volte ao site e informe seu CPF no formulário: ${linkRetomar}`,
      ``,
      `Dúvidas? ${EMAIL_CONTATO}`,
      `— ${ORGANIZADOR}`,
    ].join("\n"),
  };
}

// -------- template: CONFIRMADO ------------------------------------------

/**
 * dados: { nome, numero_inscricao, tipo, valor_pago, e2eid, data_pagamento }
 */
export function pagamentoConfirmado(dados) {
  const nome = primeiroNome(dados.nome);
  const referente = rotuloReferente(dados.tipo);
  const soDoacao = dados.tipo === "DOACAO";
  const temCamisa = dados.tipo === "CAMISA" || dados.tipo === "MISTO";

  const tabela = tabelaKV([
    ["Nº de inscrição", `#${esc(dados.numero_inscricao)}`],
    ["Referente a", esc(referente)],
    [soDoacao ? "Valor doado" : "Valor pago", brl(dados.valor_pago), { corValor: COR_SUCESSO_FG }],
    ["Data", esc(dados.data_pagamento || "-")],
    dados.e2eid ? ["Comprovante (e2eid)", `<code style="font-family:monospace;font-size:11px;word-break:break-all;">${esc(dados.e2eid)}</code>`] : null,
  ]);

  let titulo, subject, preheader, abertura, destaque;

  if (soDoacao) {
    titulo = `Obrigado pela doação, ${esc(nome)}! 💛`;
    subject = "Sua doação foi recebida — obrigado! 💛";
    preheader = `Obrigado, ${nome}! Sua doação de ${brl(dados.valor_pago)} certamente fará diferença.`;
    abertura = "Sua contribuição certamente fará diferença: ela ajuda a levar orientação e prevenção ao diabetes para toda a comunidade.";
    destaque = `📍 Nos vemos na largada! Retirada de pulseiras a partir das <strong>07h00 do dia ${esc(DATA_EVENTO)}</strong>.`;
  } else if (temCamisa) {
    titulo = `Obrigado por colaborar, ${esc(nome)}! 💙`;
    subject = "Recebemos seu Pix — sua camisa já está sendo preparada 💙";
    preheader = `Obrigado, ${nome}! Pagamento de ${brl(dados.valor_pago)} confirmado.`;
    abertura = dados.tipo === "MISTO"
      ? "Recebemos seu pagamento. Já estamos preparando sua <strong>camisa com todo carinho</strong> — e sua doação vai ajudar a levar prevenção ao diabetes para mais pessoas."
      : "Recebemos seu pagamento. Já estamos preparando sua <strong>camisa com todo carinho</strong>.";
    destaque = `📍 Sua camisa estará esperando por você na retirada de pulseiras, a partir das <strong>07h00 do dia ${esc(DATA_EVENTO)}</strong>.`;
  } else {
    titulo = `Pagamento confirmado, ${esc(nome)}! 💙`;
    subject = `Pagamento confirmado — ${referente} (${brl(dados.valor_pago)})`;
    preheader = `Recebemos ${brl(dados.valor_pago)} referente a ${referente}.`;
    abertura = "Recebemos seu pagamento. Obrigado por colaborar com a causa!";
    destaque = `📍 Nos vemos na largada! Retirada de pulseiras a partir das <strong>07h00 do dia ${esc(DATA_EVENTO)}</strong>.`;
  }

  const blocos = [
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${abertura}</p>`,
    tabela,
    `<div style="margin-top:16px;background:${COR_SUCESSO_BG};border:1px solid ${COR_SUCESSO_FG}55;border-radius:10px;padding:12px 14px;color:${COR_SUCESSO_FG};font-size:14px;line-height:1.55;">${destaque}</div>`,
    blocoAlimento,
  ];

  return {
    subject,
    html: layout({
      titulo,
      preheader,
      selo: "sucesso",
      blocos,
      ctaTexto: "Ver detalhes no site",
      ctaHref: LINK_SITE,
    }),
    text: [
      soDoacao ? `Obrigado pela sua doação, ${nome}!` : `Obrigado por colaborar, ${nome}!`,
      ``,
      soDoacao
        ? "Sua contribuição certamente fará diferença: ajuda a levar orientação e prevenção ao diabetes para toda a comunidade."
        : (temCamisa
            ? (dados.tipo === "MISTO"
                ? "Recebemos seu pagamento. Já estamos preparando sua camisa com todo carinho — e sua doação vai ajudar a levar prevenção ao diabetes para mais pessoas."
                : "Recebemos seu pagamento. Já estamos preparando sua camisa com todo carinho.")
            : "Recebemos seu pagamento. Obrigado por colaborar!"),
      ``,
      `Nº de inscrição: #${dados.numero_inscricao}`,
      `Referente a: ${referente}`,
      `${soDoacao ? "Valor doado" : "Valor pago"}: ${brl(dados.valor_pago)}`,
      `Data: ${dados.data_pagamento || "-"}`,
      dados.e2eid ? `Comprovante (e2eid): ${dados.e2eid}` : null,
      ``,
      temCamisa
        ? `Sua camisa estará esperando por você na retirada de pulseiras, a partir das 07h00 do dia ${DATA_EVENTO} em ${LOCAL_EVENTO}.`
        : `Nos vemos na largada em ${DATA_EVENTO} — retirada de pulseiras a partir das 07h00 em ${LOCAL_EVENTO}.`,
      ``,
      LEMBRETE_ALIMENTO,
      ``,
      `Camisa, doação ou ajustes: ${LINK_SITE}/ (informe seu CPF no formulário).`,
      `Dúvidas? ${EMAIL_CONTATO}`,
      `— ${ORGANIZADOR}`,
    ].filter((x) => x !== null).join("\n"),
  };
}
