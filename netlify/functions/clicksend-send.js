// MSGFLOW – ClickSend gateway (Netlify Function)
// Placering i dit repo: netlify/functions/clicksend-send.js
// Kaldes fra webappen: POST /.netlify/functions/clicksend-send
//
// Miljøvariabler i Netlify (Site settings → Environment variables):
//   CLICKSEND_USERNAME   dit ClickSend-brugernavn (det du logger ind med)
//   CLICKSEND_API_KEY    din ClickSend API-nøgle
//   SUPABASE_URL         fx https://xxxx.supabase.co
//   SUPABASE_ANON_KEY    din Supabase anon-nøgle
//
// Body (JSON): { "to": ["+4512345678", ...], "body": "tekst", "from": "MSGFLOW" }
// Header:      Authorization: Bearer <brugerens Supabase access_token>

const CLICKSEND_URL = "https://rest.clicksend.com/v3/sms/send";
const BATCH_SIZE = 1000; // ClickSends maksimum pr. kald

const json = (statusCode, data) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});

// Kun indloggede MSGFLOW-brugere må sende – ellers kan alle bruge din saldo.
async function getUser(authHeader) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!authHeader || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  return res.ok ? res.json() : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Kun POST" });

  const { CLICKSEND_USERNAME, CLICKSEND_API_KEY } = process.env;
  if (!CLICKSEND_USERNAME || !CLICKSEND_API_KEY) {
    return json(500, { error: "ClickSend-miljøvariabler mangler i Netlify" });
  }

  const user = await getUser(event.headers.authorization);
  if (!user) return json(401, { error: "Ikke logget ind" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Ugyldig JSON" });
  }

  const auth =
    "Basic " + Buffer.from(`${CLICKSEND_USERNAME}:${CLICKSEND_API_KEY}`).toString("base64");

  // Statusopslag: de seneste beskeder, som ClickSend selv har registreret dem
  if (payload.action === "history") {
    try {
      const res = await fetch("https://rest.clicksend.com/v3/sms/history?limit=10", {
        headers: { Authorization: auth },
      });
      const data = await res.json();
      if (!res.ok) return json(502, { error: data.response_msg || `HTTP ${res.status}` });
      const messages = (data.data?.data || []).map((m) => ({
        date: m.date,
        to: m.to,
        from: m.from,
        status: m.status,
        status_text: m.status_text,
        error_text: m.error_text,
        price: m.message_price,
        id: m.message_id,
      }));
      return json(200, { total: data.data?.total, messages });
    } catch (err) {
      return json(502, { error: err.message });
    }
  }

  const body = String(payload.body || "").trim();
  const from = payload.from ? String(payload.from).trim() : undefined;
  const to = [...new Set((payload.to || []).map((n) => String(n).replace(/[\s-]/g, "")))]
    .filter((n) => /^\+?\d{8,15}$/.test(n));

  if (!body) return json(400, { error: "Beskeden er tom" });
  if (!to.length) return json(400, { error: "Ingen gyldige modtagere" });

  const result = { accepted: 0, failed: 0, price: 0, queued: 0, errors: [], details: [], account: null };

  // Hvilken ClickSend-konto hører nøglen til, og hvad er saldoen?
  try {
    const accRes = await fetch("https://rest.clicksend.com/v3/account", {
      headers: { Authorization: auth },
    });
    const acc = await accRes.json();
    if (accRes.ok && acc.data) {
      result.account = {
        username: acc.data.username,
        email: acc.data.user_email,
        balance: acc.data.balance,
        currency: acc.data._currency?.currency_name_short,
      };
    }
  } catch {}

  for (let i = 0; i < to.length; i += BATCH_SIZE) {
    const batch = to.slice(i, i + BATCH_SIZE);
    const messages = batch.map((number) => ({
      source: "msgflow",
      to: number,
      body,
      ...(from ? { from } : {}),
    }));

    try {
      const res = await fetch(CLICKSEND_URL, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = await res.json();

      if (!res.ok) {
        result.failed += batch.length;
        result.errors.push(data.response_msg || `HTTP ${res.status}`);
        continue;
      }

      for (const m of data.data?.messages || []) {
        if (result.details.length < 20) {
          result.details.push(
            `${m.to} · status ${m.status} · id ${m.message_id} · pris ${m.message_price} · fra ${m.from}`
          );
        }
        if (m.status === "SUCCESS") result.accepted++;
        else {
          result.failed++;
          if (result.errors.length < 20) result.errors.push(`${m.to}: ${m.status}`);
        }
      }
      result.price += Number(data.data?.total_price || 0);
      result.queued += Number(data.data?.queued_count || 0);
    } catch (err) {
      result.failed += batch.length;
      result.errors.push(err.message);
    }
  }

  return json(200, { gateway: "clicksend", total: to.length, ...result });
};
