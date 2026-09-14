// Server-side tracking worker for Meta CAPI + TikTok Events API
// Deploy to Cloudflare Workers (free tier: 100K requests/day)

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const url = new URL(request.url);
      const body = await request.json();

      // Verify API key
      const apiKey = request.headers.get('x-api-key');
      if (apiKey !== env.TRACKING_API_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }

      let result;

      switch (url.pathname) {
        case '/api/track/meta':
          result = await trackMetaCAPI(body, env);
          break;
        case '/api/track/tiktok':
          result = await trackTikTok(body, env);
          break;
        case '/api/track':
          // Track both platforms in parallel
          const [metaResult, tiktokResult] = await Promise.allSettled([
            trackMetaCAPI(body, env),
            trackTikTok(body, env),
          ]);
          result = {
            meta: metaResult.status === 'fulfilled' ? metaResult.value : { error: metaResult.reason?.message },
            tiktok: tiktokResult.status === 'fulfilled' ? tiktokResult.value : { error: tiktokResult.reason?.message },
          };
          break;
        default:
          return new Response('Not found', { status: 404 });
      }

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getCORSHeaders() },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...getCORSHeaders() },
      });
    }
  },
};

// ==================== META CAPI ====================
async function trackMetaCAPI(body, env) {
  const { event_name, event_id, event_time, user_data, custom_data, value, currency } = body;

  const payload = {
    data: [{
      event_name,
      event_time: event_time || Math.floor(Date.now() / 1000),
      event_id, // deduplication key — matches client-side pixel event_id
      user_data: {
        // Auto-advanced matching — hashed server-side
        ...user_data,
      },
      custom_data: custom_data || {},
      action_source: 'website',
      event_source_url: body.event_source_url || 'https://tareqmonwer.github.io/raf-landing/',
    }],
  };

  // Add value/currency for purchase events
  if (value !== undefined) {
    payload.data[0].custom_data.value = value;
    payload.data[0].custom_data.currency = currency || 'BDT';
  }

  const url = `https://graph.facebook.com/v18.0/${env.META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return await res.json();
}

// ==================== TIKTOK EVENTS API ====================
async function trackTikTok(body, env) {
  const { event_name, event_id, event_time, user_data, custom_data, value, currency } = body;

  // TikTok event mapping
  const tiktokEventMap = {
    'PageView': 'ViewContent',
    'ViewContent': 'ViewContent',
    'Lead': 'SubmitForm',
    'InitiateCheckout': 'InitiateCheckout',
    'Purchase': 'CompletePayment',
  };

  const payload = {
    event: tiktokEventMap[event_name] || event_name,
    event_id, // deduplication
    timestamp: event_time ? new Date(event_time * 1000).toISOString() : new Date().toISOString(),
    context: {
      user_agent: body.user_agent || '',
      page_url: body.event_source_url || 'https://tareqmonwer.github.io/raf-landing/',
      ip: body.ip || '',
    },
    user: {
      ...user_data,
    },
    properties: {
      content_name: event_name,
      value: value || 0,
      currency: currency || 'BDT',
      ...custom_data,
    },
  };

  const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Access-Token': env.TIKTOK_EVENTS_TOKEN,
    },
    body: JSON.stringify({
      pixel_code: env.TIKTOK_PIXEL_ID,
      event: payload.event,
      event_id: payload.event_id,
      timestamp: payload.timestamp,
      context: payload.context,
      user: payload.user,
      properties: payload.properties,
    }),
  });

  return await res.json();
}

// ==================== HELPERS ====================
function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(),
  });
}

function getCORSHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
  };
}
