// backend/api/src/utils/llmClient.js
import { GoogleGenAI } from "@google/genai";

// Ensure Windows local certificate chains do not break external TLS handshakes
if (process.platform === "win32" && !process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export const LLM_MODEL = process.env.LLM_MODEL || "gemini-3.8-flash";
const NVIDIA_INVOKE_URL = process.env.LLM_BASE_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;

// Lazy-initialized GoogleGenAI client
let genAIClient = null;
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!genAIClient) {
    genAIClient = new GoogleGenAI({ apiKey });
  }
  return genAIClient;
}

/**
 * Format tools from OpenAI format to Gemini FunctionDeclarations
 */
function formatToolsForGemini(tools) {
  if (!tools || !tools.length) return undefined;

  const functionDeclarations = tools.map((t) => {
    const fn = t.function || t;
    const params = fn.parameters || {};

    const formatProps = (props = {}) => {
      const formatted = {};
      for (const [k, v] of Object.entries(props)) {
        formatted[k] = {
          type: (v.type || "string").toUpperCase(),
          description: v.description || "",
        };
        if (v.properties) {
          formatted[k].properties = formatProps(v.properties);
        }
      }
      return formatted;
    };

    return {
      name: fn.name,
      description: fn.description || "",
      parameters: {
        type: (params.type || "OBJECT").toUpperCase(),
        properties: formatProps(params.properties),
        required: params.required || [],
      },
    };
  });

  return [{ functionDeclarations }];
}

/**
 * Format OpenAI messages to Gemini contents and system instruction
 */
function formatMessagesForGemini(messages) {
  let systemInstruction = "";
  const contents = [];

  for (const m of messages) {
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      systemInstruction = systemInstruction ? `${systemInstruction}\n${text}` : text;
      continue;
    }

    const role = m.role === "assistant" ? "model" : "user";
    const parts = [];

    if (typeof m.content === "string") {
      parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === "text") {
          parts.push({ text: part.text });
        } else if (part.type === "image_url" && part.image_url?.url) {
          const match = part.image_url.url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
    }

    contents.push({ role, parts });
  }

  return { systemInstruction, contents };
}

/**
 * Call Gemini 3.8 Flash via @google/genai with automatic retry logic
 */
async function callGemini({ messages, tools, json, maxTokens }) {
  const ai = getGenAIClient();
  if (!ai) throw new Error("GEMINI_API_KEY is not configured");

  const { systemInstruction, contents } = formatMessagesForGemini(messages);
  const geminiTools = formatToolsForGemini(tools);

  const config = {
    maxOutputTokens: maxTokens || 4096,
  };

  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  if (json) {
    config.responseMimeType = "application/json";
  }

  if (geminiTools) {
    config.tools = geminiTools;
  }

  const modelName = LLM_MODEL.startsWith("gemini") ? LLM_MODEL : "gemini-3.8-flash";

  let lastError = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config,
      });

      const toolCalls = response.functionCalls?.map((call, idx) => ({
        id: call.id || `call_${idx}_${Date.now()}`,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.args || {}),
        },
      }));

      return {
        content: response.text || "",
        tool_calls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (err) {
      lastError = err;
      const isFatal = /API_KEY|invalid|unauthorized|401|403|400|not found|404/i.test(err.message);
      console.warn(`[LLM-GEMINI] Attempt ${attempt} failed: ${err.message}.`);
      if (isFatal) {
        break; // Fast fail immediately to NVIDIA NIM fallback
      }
      if (attempt < maxAttempts) {
        // Exponential backoff retry (1s, 2s)
        await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
  }

  throw lastError;
}

/**
 * Fallback to NVIDIA NIM if Gemini is unavailable
 */
async function callNvidiaNim({ messages, tools, json, maxTokens }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY is not set");

  const model = process.env.NVIDIA_FALLBACK_MODEL || "meta/llama-3.2-11b-vision-instruct";

  const body = {
    model,
    messages,
    max_tokens: maxTokens || 4096,
    temperature: 0.1,
    stream: false,
  };

  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(NVIDIA_INVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`NVIDIA LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("NVIDIA LLM returned no message");
  return msg;
}

/**
 * Universal chat completion. Defaults to Gemini 3.8 Flash, with resilient retries
 * and automatic fallback to NVIDIA NIM.
 * Returns { content, tool_calls } in standard format.
 */
export async function chatCompletion({ messages, tools, json = false, maxTokens = 4096 }) {
  // If a valid Gemini API key is present, prioritize fast Gemini 3.8 Flash
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 10) {
    try {
      return await callGemini({ messages, tools, json, maxTokens });
    } catch (err) {
      console.error("[LLM-CLIENT] Gemini failed, falling back to NVIDIA NIM:", err.message);
      if (process.env.NVIDIA_API_KEY) {
        return await callNvidiaNim({ messages, tools, json, maxTokens });
      }
      throw err;
    }
  }

  // Otherwise direct to NVIDIA NIM
  return await callNvidiaNim({ messages, tools, json, maxTokens });
}
