# Templates de e-mail — versões renderizadas

Exemplos com dados reais dos handlers. Serve para você comparar visual,
copy, hierarquia e sugerir melhorias antes de subir a prod.

Placeholders da marca vivem em `src/emails.js` (topo do arquivo). Cor
primária `#16357F` (azul), destaque `#F5A800` (laranja).

---

## 1. `confirmacaoInscricao` — com valor em aberto

**Contexto**: Ana Silva (id #42) escolheu camisa M + doou R$ 5 →
total R$ 45,01 a pagar.

### Subject
```
Inscrição confirmada — pagamento em aberto (R$ 45,01)
```

### Preheader
`Pague R$ 45,01 para garantir a camisa/doação.`

### Corpo (texto puro)
```
Olá, Ana!

Sua inscrição no Treino Solidário Contra o Diabetes foi registrada.
Data: 08/11/2026 — Pista Atlética Municipal — Bento Gonçalves/RS

Nº de inscrição: #42
Modalidade: corrida-5km
Camiseta: tamanho M — R$ 40,00
Doação solidária: R$ 5,00
Total a pagar: R$ 45,01

Pague o Pix: https://treinosolidario.lccidadedovinho.com.br/#retomar?cpf=39053344705

Dúvidas? lionsclubebgcidadedovinho@gmail.com
— Lions Clube Bento Gonçalves — Cidade do Vinho
```

### Corpo (HTML — layout visual)
- Header azul `#16357F` com "TREINO SOLIDÁRIO" e "Treino Solidário Contra o Diabetes · 08/11/2026"
- Título `Inscrição confirmada!`
- Parágrafo "Olá, Ana! …"
- Parágrafo "Nos vemos na largada em 08/11/2026 …"
- Tabela resumo: Nº · Modalidade · Camiseta · Doação · Total (destaque laranja em "Total a pagar")
- Aviso amarelo `Você tem R$ 45,01 em aberto (camisa/doação). Pague pelo Pix…`
- CTA laranja `Pagar Pix agora` → deep link `/#retomar?cpf=<cpf>`
- Rodapé com contato + link do site

HTML completo (raw):

```html
<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inscrição confirmada!</title></head>
<body style="margin:0;padding:0;background:#F6F8FC;font-family:Arial,Helvetica,sans-serif;color:#33415E;">
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">Pague R$ 45,01 para garantir a camisa/doação.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F8FC;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#16357F;color:#FFFFFF;padding:22px 28px;">
        <div style="font-family:Arial,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:0.04em;font-size:20px;">Treino Solidário</div>
        <div style="font-size:13px;color:#C9D6F0;margin-top:2px;">Treino Solidário Contra o Diabetes · 08/11/2026</div>
      </td></tr>
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 16px;color:#16357F;font-family:Arial,sans-serif;font-size:22px;">Inscrição confirmada!</h1>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Olá, <strong style="color:#16357F;">Ana</strong>! Sua inscrição no <strong>Treino Solidário Contra o Diabetes</strong> foi registrada.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Nos vemos na largada em <strong>08/11/2026</strong>, na Pista Atlética Municipal — Bento Gonçalves/RS.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #EDF1F9;border-radius:10px;padding:8px 16px;background:#F6F8FC;"><tr>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#6B7A99;">Nº de inscrição</td>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#16357F;font-weight:700;text-align:right;">#42</td>
     </tr><tr>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#6B7A99;">Modalidade</td>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#16357F;font-weight:700;text-align:right;">corrida-5km</td>
     </tr><tr>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#6B7A99;">Camiseta</td>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#16357F;font-weight:700;text-align:right;">Tamanho M · R$ 40,00</td>
     </tr><tr>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#6B7A99;">Doação solidária</td>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#16357F;font-weight:700;text-align:right;">R$ 5,00</td>
     </tr><tr>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#6B7A99;">Total a pagar</td>
       <td style="padding:8px 0;border-bottom:1px solid #EDF1F9;font-size:14px;color:#16357F;font-weight:700;text-align:right;">R$ 45,01</td>
     </tr></table>
<p style="margin:16px 0 0;font-size:14px;color:#B57100;">Você tem <strong>R$ 45,01</strong> em aberto (camisa/doação). Pague pelo Pix para garantir o pedido — o botão abaixo abre o QR direto pra você.</p>
      </td></tr>
      <tr><td align="center" style="padding:24px 0 8px;">
         <a href="https://treinosolidario.lccidadedovinho.com.br/#retomar?cpf=39053344705" style="background:#F5A800;color:#16357F;text-decoration:none;font-family:Arial,sans-serif;font-weight:800;font-size:16px;padding:14px 28px;border-radius:10px;display:inline-block;text-transform:uppercase;letter-spacing:0.04em;">Pagar Pix agora</a>
       </td></tr>
      <tr><td style="padding:20px 28px 28px;font-size:12px;color:#6B7A99;line-height:1.5;">
        Dúvidas? Responda este e-mail ou escreva para
        <a href="mailto:lionsclubebgcidadedovinho@gmail.com" style="color:#16357F;font-weight:700;">lionsclubebgcidadedovinho@gmail.com</a>.
      </td></tr>
    </table>
    <div style="max-width:600px;margin:16px auto 0;font-size:11px;color:#8A97B0;text-align:center;line-height:1.5;">
      Lions Clube Bento Gonçalves — Cidade do Vinho · Pista Atlética Municipal — Bento Gonçalves/RS<br>
      <a href="https://treinosolidario.lccidadedovinho.com.br" style="color:#8A97B0;">https://treinosolidario.lccidadedovinho.com.br</a>
    </div>
  </td></tr>
</table>
</body></html>
```

---

## 2. `confirmacaoInscricao` — inscrição gratuita (sem camisa/doação)

**Contexto**: Bruno (id #99), caminhada 5 km, sem camisa, sem doação.

### Subject
```
Inscrição confirmada — Treino Solidário
```

### Preheader
`Nos vemos na largada em 08/11/2026.`

### Corpo (texto puro)
```
Olá, Bruno!

Sua inscrição no Treino Solidário Contra o Diabetes foi registrada.
Data: 08/11/2026 — Pista Atlética Municipal — Bento Gonçalves/RS

Nº de inscrição: #99
Modalidade: caminhada-5km
Inscrição gratuita — leve 1 kg de alimento no dia.

Site: https://treinosolidario.lccidadedovinho.com.br

Dúvidas? lionsclubebgcidadedovinho@gmail.com
— Lions Clube Bento Gonçalves — Cidade do Vinho
```

Diferenças do modelo anterior:
- Tabela mostra só: Nº · Modalidade · `Inscrição: Gratuita — leve 1 kg…`
- Sem aviso amarelo de valor em aberto
- Rodapé `Não esqueça de levar 1 kg de alimento não perecível…`
- CTA `Ver detalhes no site` (não "Pagar Pix agora")

---

## 3. `pagamentoConfirmado` — inscrição + extras (MISTO)

**Contexto**: Ana (id #42) pagou R$ 45,01 (inscrição + camisa + doação).

### Subject
```
Pagamento confirmado — Inscrição + extras (R$ 45,01)
```

### Preheader
`Recebemos R$ 45,01 referente a Inscrição + extras.`

### Corpo (texto puro)
```
Obrigado, Ana!

Pagamento confirmado.
Nº de inscrição: #42
Referente a: Inscrição + extras
Valor pago: R$ 45,01
Data: 14/09/2026 15:30:12
Comprovante (e2eid): E12345678202609141234ABCDEF01234

Retire sua pulseira a partir das 07h00 do dia 08/11/2026 em Pista Atlética Municipal — Bento Gonçalves/RS, levando 1 kg de alimento não perecível.

Dúvidas? lionsclubebgcidadedovinho@gmail.com
— Lions Clube Bento Gonçalves — Cidade do Vinho
```

### HTML — resumo
- Header azul igual
- Título `Pagamento confirmado!`
- Parágrafo "Obrigado, Ana! Seu pagamento foi confirmado."
- Tabela: Nº · Referente a · Valor · Data · Comprovante (e2eid, em monospace)
- Parágrafo "Retire sua pulseira a partir das 07h00 do dia 08/11/2026…"
- CTA laranja `Ver detalhes no site`

Nomes do campo `Referente a` conforme `tipo` do pagamento:

| tipo | Referente a |
|---|---|
| `INSCRICAO` | Inscrição |
| `CAMISA` | Camisa |
| `DOACAO` | Doação |
| `MISTO` | Inscrição + extras |

### Exemplo somente camisa

Subject:
```
Pagamento confirmado — Camisa (R$ 40,00)
```

Texto:
```
Obrigado, Bruno!

Pagamento confirmado.
Nº de inscrição: #99
Referente a: Camisa
Valor pago: R$ 40,00
Data: 15/09/2026 09:00:00

Retire sua pulseira a partir das 07h00 do dia 08/11/2026 em Pista Atlética Municipal — Bento Gonçalves/RS, levando 1 kg de alimento não perecível.

Dúvidas? lionsclubebgcidadedovinho@gmail.com
— Lions Clube Bento Gonçalves — Cidade do Vinho
```

Sem linha de `Comprovante (e2eid)` quando ele não vier no webhook.

---

## 4. `ALERTA_INTERNO` — pagamento após cancelamento

Não é template com layout — é um `sendEmail` cru pra
`lionsclubebgcidadedovinho@gmail.com`. Cai só quando `handleWebhookPix`
marca `CONCLUIDA` numa cobrança que estava `REMOVIDA_PELO_USUARIO_RECEBEDOR`.

### Subject
```
[Atenção] Pagamento após cancelamento — inscrição #<id>
```

### Corpo
```
Pagamento recebido em cobrança já cancelada pelo usuário.

- Inscrição: #<id>
- txid: <txid>
- e2eid: <e2eid>
- valor: R$ <valor>

Necessária ação manual: reativar camisa/doação OU fazer devolução via API Sicredi.
```

---

## Prontos para futuro (ainda não usados)

Estão previstos em `docs/EMAIL.md` mas ainda não implementados:

- `PENDENTE` — para atletas com valor em aberto, disparo manual pelo painel.
- `OFERTA_CAMISA` — para atletas sem camisa, disparo manual.
- `AVISO_GERAL` — corpo livre editado no painel na hora do envio.

Quando implementar, ficam neste arquivo também.

---

## Onde mexer

- Copy/texto: `src/emails.js` (funções `confirmacaoInscricao` e
  `pagamentoConfirmado`).
- Cores e header: constantes no topo do arquivo (`COR_PRIMARIA`,
  `COR_DESTAQUE`) e função `layout(...)`.
- Logo — hoje não temos imagem no cabeçalho, só texto. Se quiser incluir,
  hospedar em `public/img/` e referenciar via URL absoluta
  (`https://treinosolidario.lccidadedovinho.com.br/img/logo_lions.png`).
  Alguns clients bloqueiam imagem por padrão — o layout precisa continuar
  legível sem elas.
