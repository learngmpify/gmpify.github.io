// netlify/functions/kit-subscribe.js
//
// Server-side email signup for the free tools. The Kit API key lives only in
// this function's environment (Netlify: Site configuration > Environment
// variables > KIT_API_KEY) and is never sent to the browser.
//
// Tool pages call:
//   fetch('/.netlify/functions/kit-subscribe', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ email: 'person@example.com', source: 'em-reviewer' })
//   })

const ALLOWED_ORIGINS = [
  'https://gmpify-tools.netlify.app',
  'https://gmpify.com',
  'https://www.gmpify.com',
];

// Kit form that new tool subscribers are added to.
// Can be overridden with a KIT_FORM_ID environment variable.
const DEFAULT_FORM_ID = '10011941';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

exports.handler = async function (event) {
  const origin = event.headers.origin || event.headers.Origin || '';
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.KIT_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server misconfiguration: KIT_API_KEY is not set.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  const email = String(payload.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  const formId = process.env.KIT_FORM_ID || DEFAULT_FORM_ID;
  const kitHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Kit-Api-Key': apiKey,
  };

  try {
    // 1. Create the subscriber (Kit returns the existing one if already on the list)
    const created = await fetch('https://api.kit.com/v4/subscribers', {
      method: 'POST',
      headers: kitHeaders,
      body: JSON.stringify({ email_address: email }),
    });
    if (!created.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not save your email right now. Please try again.' }) };
    }

    // 2. Add them to the tools signup form
    const added = await fetch('https://api.kit.com/v4/forms/' + encodeURIComponent(formId) + '/subscribers', {
      method: 'POST',
      headers: kitHeaders,
      body: JSON.stringify({ email_address: email }),
    });
    if (!added.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not save your email right now. Please try again.' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not save your email right now. Please try again.' }) };
  }
};
