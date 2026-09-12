#!/usr/bin/env node
/**
 * Teste standalone Sicredi API Pix — valida mTLS + OAuth.
 *
 * Uso:
 *   node scripts/test-sicredi.mjs token          # só oauth/token
 *   node scripts/test-sicredi.mjs cob <valor>    # cria cobrança de <valor>
 *   node scripts/test-sicredi.mjs status <txid>  # consulta cobrança
 *
 * Variáveis (carrega de .dev.vars automaticamente se existir):
 *   SICREDI_AMBIENTE       "producao" | "homologacao"  (default: producao)
 *   SICREDI_CLIENT_ID
 *   SICREDI_CLIENT_SECRET
 *   SICREDI_CHAVE_PIX      (necessária p/ criar cobrança)
 *   SICREDI_CERT_PATH      (default: certificados/06304442000108.cer)
 *   SICREDI_KEY_PATH       (default: certificados/api-pix-lccidadedovinho.pem)
 *   SICREDI_CA_PATH        (opcional: certificados/CadeiaCompletaSicredi.cer)
 */

import { readFileSync, existsSync } from "node:fs";
import https from "node:https";
import { randomBytes } from "node:crypto";
import path from "node:path";

carregarDevVars(".dev.vars");

const AMB = process.env.SICREDI_AMBIENTE || "producao";
const HOST = AMB === "homologacao" ? "api-pix-h.sicredi.com.br" : "api-pix.sicredi.com.br";

const CLIENT_ID = must("SICREDI_CLIENT_ID");
const CLIENT_SECRET = must("SICREDI_CLIENT_SECRET");
const CERT_PATH = process.env.SICREDI_CERT_PATH || "certificados/06304442000108.cer";
const KEY_PATH = process.env.SICREDI_KEY_PATH || "certificados/api-pix-lccidadedovinho.pem";
const CA_PATH = process.env.SICREDI_CA_PATH || "certificados/CadeiaCompletaSicredi.cer";

// Cert servidor api-pix.sicredi.com.br é emitido por DigiCert (root público, já no
// trust store do Node). Não passamos `ca:` — se passássemos com CadeiaCompletaSicredi
// (que é da CA cliente Sicredi), sobrescreveríamos o trust default e daria
// "unable to get local issuer certificate".
// Cert+chave cliente (mTLS) são enviados via `cert`/`key`.
const cert = readFileSync(CERT_PATH);
const key = readFileSync(KEY_PATH);
void CA_PATH; // reservado p/ futuro (pin de cadeia server)

const agent = new https.Agent({ cert, key, keepAlive: true });

const cmd = process.argv[2] || "token";
try {
  if (cmd === "token") {
    const t = await getToken();
    console.log("OK — access_token obtido");
    console.log("scope:", t.scope);
    console.log("expires_in:", t.expires_in);
    console.log("token[0..40]:", t.access_token.slice(0, 40) + "...");
  } else if (cmd === "cob") {
    const valor = Number(process.argv[3] || "0.01").toFixed(2);
    const chavePix = must("SICREDI_CHAVE_PIX");
    const txid = "LCCV" + randomBytes(16).toString("hex").slice(0, 26);
    const t = await getToken();
    const body = {
      calendario: { expiracao: 1800 },
      valor: { original: valor, modalidadeAlteracao: 0 },
      chave: chavePix,
      solicitacaoPagador: "Teste mTLS LCCV",
    };
    const r = await req("PUT", `/api/v3/cob/${txid}`, t.access_token, body);
    console.log("HTTP", r.status);
    console.log(JSON.stringify(r.json ?? r.texto, null, 2));
    if (r.json?.pixCopiaECola) {
      console.log("\n=== PIX COPIA E COLA ===\n" + r.json.pixCopiaECola);
      console.log("\ntxid:", txid);
    }
  } else if (cmd === "status") {
    const txid = process.argv[3];
    if (!txid) throw new Error("txid obrigatório");
    const t = await getToken();
    const r = await req("GET", `/api/v3/cob/${encodeURIComponent(txid)}`, t.access_token);
    console.log("HTTP", r.status);
    console.log(JSON.stringify(r.json ?? r.texto, null, 2));
  } else {
    console.error("Comando desconhecido:", cmd);
    process.exit(2);
  }
} catch (e) {
  console.error("ERRO:", e.message);
  if (e.detalhes) console.error(e.detalhes);
  process.exit(1);
}

async function getToken() {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = "grant_type=client_credentials&scope=" +
    encodeURIComponent("cob.write cob.read pix.read webhook.read webhook.write");
  const r = await raw("POST", "/oauth/token", {
    Authorization: `Basic ${basic}`,
    "Content-Type": "application/x-www-form-urlencoded",
  }, body);
  if (r.status !== 200) {
    const err = new Error(`oauth/token HTTP ${r.status}`);
    err.detalhes = (r.texto || "").slice(0, 800);
    throw err;
  }
  return r.json;
}

async function req(method, caminho, token, body) {
  return raw(method, caminho, {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  }, body ? JSON.stringify(body) : undefined);
}

function raw(method, caminho, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST, port: 443, method, path: caminho, headers, agent,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const texto = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = texto ? JSON.parse(texto) : null; } catch {}
        resolve({ status: res.statusCode, texto, json });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function must(nome) {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável ${nome} não definida`);
  return v;
}

function carregarDevVars(arquivo) {
  const p = path.resolve(arquivo);
  if (!existsSync(p)) return;
  const conteudo = readFileSync(p, "utf8");
  for (const linha of conteudo.split(/\r?\n/)) {
    const s = linha.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const chave = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(chave in process.env)) process.env[chave] = val;
  }
}
