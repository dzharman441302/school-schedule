import app from './index.js';

const MAX_API = 'https://platform-api2.max.ru';

async function maxJson(env, method, endpoint, body) {
  const response = await fetch(MAX_API + endpoint, {
    method,
    headers: {
      Authorization: String(env.BOT_TOKEN || ''),
      ...(body ? {'Content-Type': 'application/json'} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {raw: text}; }
  return {ok: response.ok, status: response.status, data};
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8'}
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/max-check') {
      const r = await maxJson(env, 'GET', '/me');
      if (!r.ok) return json({ok:false, stage:'MAX /me', status:r.status, response:r.data}, 502);
      const bot = r.data || {};
      return json({
        ok: true,
        bot: {
          user_id: bot.user_id ?? null,
          name: bot.name ?? '',
          username: bot.username ?? '',
          is_bot: bot.is_bot ?? true
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/setup-webhook') {
      const secret = String(env.WEBHOOK_SECRET || '');
      if (!/^[A-Za-z0-9_-]{5,256}$/.test(secret)) {
        return json({ok:false, error:'WEBHOOK_SECRET is missing or invalid'}, 500);
      }
      if (!env.BOT_TOKEN) return json({ok:false, error:'BOT_TOKEN is missing'}, 500);

      const webhookUrl = `${url.origin}/webhook`;
      const current = await maxJson(env, 'GET', '/subscriptions');
      if (!current.ok) {
        return json({ok:false, stage:'GET /subscriptions', status:current.status, response:current.data}, 502);
      }
      const list = Array.isArray(current.data)
        ? current.data
        : Array.isArray(current.data?.subscriptions)
          ? current.data.subscriptions
          : [];
      const existing = list.find(x => String(x?.url || '') === webhookUrl);
      if (existing) {
        return json({ok:true, already_registered:true, webhook:webhookUrl, subscription:existing});
      }

      const created = await maxJson(env, 'POST', '/subscriptions', {
        url: webhookUrl,
        update_types: ['bot_started', 'message_created', 'message_callback'],
        secret
      });
      if (!created.ok) {
        return json({ok:false, stage:'POST /subscriptions', status:created.status, response:created.data}, 502);
      }
      return json({ok:true, registered:true, webhook:webhookUrl, response:created.data});
    }

    return app.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  }
};
