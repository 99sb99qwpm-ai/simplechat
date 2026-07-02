// api/chat.js

export const config = {
  runtime: 'edge', // Zwingt Vercel, diese Route in der Edge Runtime auszuführen
};

export default async function handler(req) {
  // 1. CORS-Header für die Kommunikation mit dem Frontend setzen
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // Im Produktivbetrieb später idealerweise auf deine Domain beschränken
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Preflight-Anfragen (OPTIONS) abfangen
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Nur POST-Requests erlauben
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    // 2. Daten aus dem Frontend-Request extrahieren
    const { message, history } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400, headers });
    }

    // 3. API-Key aus den Umgebungsvariablen laden
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not configured on Vercel' }), { status: 500, headers });
    }

    // 4. Historie in das von Gemini erwartete Format (contents) konvertieren
    // Gemini erwartet 'user' oder 'model' (dein Frontend schickt 'assistant')
    const contents = [];
    
    if (history && Array.isArray(history)) {
      history.forEach(turn => {
        contents.push({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }]
        });
      });
    }

    // Die aktuelle Nachricht des Nutzers ans Ende der Historie anhängen
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    // System-Instruktion hinzufügen, damit Gemini sich wie ein StockMind-Finanzexperte verhält
    const systemInstruction = {
      parts: [{ text: "You are StockMind, an elite AI market intelligence assistant. Provide sharp, objective, and analytical financial insights, stock analysis, and macroeconomic breakdowns. Use professional formatting." }]
    };

    // 5. Verbindung zur Gemini API aufbauen (Nutzt Gemini 2.5 Flash Lite)
    const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

    const response = await fetch(geminiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: systemInstruction,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: `Gemini API Error: ${errorText}` }), { status: response.status, headers });
    }

    const data = await response.json();

    // 6. Antwort extrahieren
    const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a response.";

    // 7. Das exakte Format zurückgeben, das deine index.html erwartet ({ reply: "..." })
    return new Response(JSON.stringify({ reply: aiReply }), { status: 200, headers });

  } catch (error) {
    console.error('Edge Function Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { status: 500, headers });
  }
}