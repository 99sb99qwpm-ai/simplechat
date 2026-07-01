// =====================================================
//  api/chat.js  — Vercel Serverless Function
//  Middleman between the frontend and Gemini API
//
//  Deployment:
//    1. Place this file at /api/chat.js in your repo
//    2. Add GEMINI_API_KEY to Vercel Environment Variables
//    3. Deploy → Vercel auto-creates the /api/chat route
// =====================================================

export const config = {
  runtime: 'edge',   // edge runtime = faster cold starts
};

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

// System prompt — shapes how Gemini responds
const SYSTEM_PROMPT = `You are StockMind, an expert AI assistant specialised in stock market analysis, financial news interpretation, and investment research. Your role is to:

- Analyse stocks, ETFs, and market sectors with depth and nuance
- Explain financial concepts clearly, from beginner to advanced
- Summarise and interpret earnings reports, macro events, and market news
- Highlight both bullish and bearish arguments fairly
- Always remind users that this is not financial advice and they should consult a professional for investment decisions

Keep responses structured and concise. Use bullet points where appropriate. When analysing a stock mention valuation, growth prospects, risks, and recent catalysts.`;

export default async function handler(req) {
  // CORS headers — allow requests from your frontend domain
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',            // tighten to your Vercel domain in prod
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Pre-flight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
      { status: 500, headers }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { message, history = [] } = body;

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400, headers });
  }

  // Build Gemini conversation contents
  // history = [{ role: 'user'|'assistant', content: '...' }, ...]
  const contents = [
    // Inject system prompt as the first user/model exchange
    { role: 'user',  parts: [{ text: SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: 'Understood. I am StockMind, ready to help with stock analysis and market research.' }] },

    // Prior conversation turns (cap at 10 to keep request size manageable)
    ...history.slice(-10).map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),

    // Current user message
    { role: 'user', parts: [{ text: message }] },
  ];

  const geminiPayload = {
    contents,
    generationConfig: {
      temperature:     0.7,
      topP:            0.9,
      maxOutputTokens: 1024,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(geminiPayload),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('Gemini API error:', errText);
      return new Response(
        JSON.stringify({ error: `Gemini error ${geminiRes.status}` }),
        { status: 502, headers }
      );
    }

    const geminiJson = await geminiRes.json();

    // Extract text from Gemini response
    const reply =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ??
      'Sorry, I could not generate a response.';

    return new Response(JSON.stringify({ reply }), { status: 200, headers });

  } catch (err) {
    console.error('Fetch error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to reach Gemini API' }),
      { status: 500, headers }
    );
  }
}
