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

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: max_tokens || 2000,
        ...(system ? { system } : {}),
        messages,
      }),
    });

    const data = await upstream.json();

    return {
      statusCode: upstream.status,
      headers,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Upstream request to Anthropic failed: ' + err.message }),
    };
  }
};
