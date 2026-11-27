const axios = require('axios');

// ── OpenRouter (API compatible con OpenAI), igual que katu_school ──────────
// Chat con herramientas (function calling). El modelo se elige en el .env y
// debe soportar herramientas. OPENROUTER_URL solo existe para las pruebas.
const config = () => ({
  apiKey: String(process.env.OPENROUTER_API_KEY || '').trim(),
  modelo: String(process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini').trim(),
  url: (String(process.env.OPENROUTER_URL || '').trim() || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
});
const disponible = () => !!config().apiKey;

class ErrorIA extends Error {}

// messages: formato OpenAI ({ role: system|user|assistant|tool, ... })
// tools: [{ type: 'function', function: { name, description, parameters } }]
// Devuelve el mensaje del asistente: { content, tool_calls? }
async function chat({ messages, tools, temperatura = 0.3, maxTokens = 900 }) {
  const { apiKey, modelo, url } = config();
  if (!apiKey) throw new ErrorIA('OPENROUTER_API_KEY no está configurada');
  try {
    const { data } = await axios.post(`${url}/chat/completions`, {
      model: modelo, messages, ...(tools?.length && { tools, tool_choice: 'auto' }), temperature: temperatura, max_tokens: maxTokens,
    }, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Katu POS' },
      timeout: 45000,
    });
    const m = data?.choices?.[0]?.message;
    if (!m) throw new ErrorIA(data?.error?.message || 'El modelo no devolvió respuesta');
    return { content: m.content || '', tool_calls: (m.tool_calls || []).filter(t => t?.function?.name), uso: data.usage || null };
  } catch (e) {
    if (e instanceof ErrorIA) throw e;
    const d = e.response?.data;
    throw new ErrorIA(`IA (${e.response?.status || 'sin respuesta'}): ${d?.error?.message || e.message}`);
  }
}

module.exports = { chat, disponible, config, ErrorIA };
