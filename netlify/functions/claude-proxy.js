// netlify/functions/claude-proxy.js
//
// Server-side proxy to the Anthropic API. The API key lives only in this
// function's environment (set in Netlify: Site settings > Environment
// variables > ANTHROPIC_API_KEY) and is never sent to the browser.
//
// Each tool page calls this function instead of api.anthropic.com directly:
//   fetch('/.netlify/functions/claude-proxy', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ system, messages, max_tokens, model })
//   })

const ALLOWED_ORIGINS = [
  'https://gmpify-tools.netlify.app',
  'https://gmpify.com',
  'https://www.gmpify.com',
];

// Stop waiting a little before Netlify cuts the function off, so the visitor
// gets a readable message instead of an HTML error page.
const UPSTREAM_TIMEOUT_MS = 25000;

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('claude-proxy: ANTHROPIC_API_KEY is not set');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server misconfiguration: ANTHROPIC_API_KEY is not set.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { system, messages, max_tokens, model } = payload;

  if (!messages) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing "messages" in request body.' }) };
  }

  const useModel = model || 'claude-sonnet-4-6';
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: useModel,
        max_tokens: max_tokens || 2000,
        ...(system ? { system } : {}),
        messages,
      }),
    });

    const data = await upstream.json();
    clearTimeout(timer);

    console.log(
      'claude-proxy: model=' + useModel +
      ' status=' + upstream.status +
      ' ms=' + (Date.now() - started) +
      (upstream.ok ? '' : ' error=' + JSON.stringify(data.error || data).slice(0, 300))
    );

    return {
      statusCode: upstream.status,
      headers,
      body: JSON.stringify(data),
    };
  } catch (err) {
    clearTimeout(timer);
    const timedOut = err && err.name === 'AbortError';
    console.log(
      'claude-proxy: FAILED model=' + useModel +
      ' ms=' + (Date.now() - started) +
      ' reason=' + (timedOut ? 'timeout after ' + UPSTREAM_TIMEOUT_MS + 'ms' : err.message)
    );
    return {
      statusCode: timedOut ? 504 : 502,
      headers,
      body: JSON.stringify({
        error: timedOut
          ? 'The request took too long to complete. Please try again.'
          : 'Upstream request to Anthropic failed: ' + err.message,
      }),
    };
  }
};
