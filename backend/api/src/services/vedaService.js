// backend/api/src/services/vedaService.js
import { queryFiles, diagnoseActiveImage } from "./vedaTools.js";
import { chatCompletion } from "../utils/llmClient.js";

const tools = [
  {
    type: "function",
    function: {
      name: "search_images",
      description:
        "Search the user's stored medical scan library by filename or anatomical body part (e.g. chest, hand, leg, knee). " +
        "Use ONLY when user asks to search, find, or list scans across their library (e.g. 'show chest images', 'find sample.jpg'). " +
        "NEVER use when user is asking about the currently open image.",
      parameters: {
        type: "object",
        properties: {
          searchKeyword: { type: "string", description: "Exact filename or keyword (e.g. 'sample.jpg', 'chest')." },
          bodyPart: { type: "string", description: "Anatomical part, e.g. chest, hand, leg, head, knee, wrist." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnose_current_image",
      description:
        "Clinically inspect the medical scan currently open in the viewer to evaluate fractures, bone anatomy, " +
        "wounds, lesions, or specific radiologic questions.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export async function processVedaMessage({ userId, message, context = {}, history = [] }) {
  console.log("[VEDA-AI] Received message:", message, "Context:", context);

  const hasActiveJob = Boolean(context.jobId && context.jobId !== "none");
  const isImageQuery = /fracture|break|broken|bone|anatomy|tib|fibul|femur|knee|wrist|hand|chest|shoulder|lesion|abnormal|diagnos|scan|what is this|what kind|which bone|where is|radiograph|x-ray|xray/i.test(message);
  const isExplicitLibrarySearch = /search\s+(my|for|all)|find\s+(my|all|other)|list\s+(my|all)|show\s+all\s+scans/i.test(message);

  // If a scan is currently open and the doctor is asking questions about bones/fractures/scan contents,
  // directly route to diagnoseActiveImage for guaranteed speed and clinical accuracy.
  if (hasActiveJob && isImageQuery && !isExplicitLibrarySearch) {
    console.log("[VEDA-AI] Direct routing to active scan diagnostic analysis for job:", context.jobId);
    try {
      const diagnosis = await diagnoseActiveImage({ jobId: context.jobId, userId, userQuestion: message });
      const hasMarker = Boolean(diagnosis.abnormalityDetected && diagnosis.marker);
      const reply = hasMarker
        ? `Fracture identified: **${diagnosis.condition}**. I have marked the fracture site below and on your image viewer:`
        : diagnosis.description;

      return {
        type: hasMarker ? "abnormality_result" : "text",
        reply,
        payload: { jobId: context.jobId, ...diagnosis },
      };
    } catch (err) {
      console.error("[VEDA-AI] Active image diagnosis failed:", err.message);
      return {
        type: "text",
        reply: "I inspected the scan, but encountered a temporary formatting issue. Please re-ask your diagnostic question.",
        payload: null,
      };
    }
  }

  const system = `
You are Veda, an intelligent clinical AI assistant for a modern medical imaging PACS platform.
Current route: "${context.currentRoute || "dashboard"}"
Active scan jobId: "${context.jobId || "none"}"

ROUTING GUIDELINES:
1. If Active scan jobId is NOT "none":
   - The doctor is viewing a specific patient radiograph.
   - For ANY question regarding the image, bone identity, anatomy, fracture, or pathology, call "diagnose_current_image".
   - Only call "search_images" if the doctor explicitly asks to search or browse OTHER library files.
2. If Active scan jobId is "none":
   - If the doctor asks to inspect an image or check for fractures, instruct them to open a scan from the Dashboard or History first.
   - For library searches (e.g. "show chest x-rays"), call "search_images".
3. For general medical knowledge or conversation, respond directly and concisely with professional clinical accuracy.
`;

  try {
    const formattedHistory = (Array.isArray(history) ? history : [])
      .slice(-6)
      .map(h => ({
        role: h.role === "assistant" || h.role === "model" ? "assistant" : "user",
        content: String(h.content || h.text || "")
      }))
      .filter(h => h.content.trim().length > 0);

    const messages = [
      { role: "system", content: system },
      ...formattedHistory,
      { role: "user", content: message },
    ];

    const msg = await chatCompletion({
      messages,
      tools,
    });

    const call = msg.tool_calls?.[0]?.function;
    let args = {};
    try { args = call?.arguments ? JSON.parse(call.arguments) : {}; } catch { /* ignore bad args */ }
    console.log("[VEDA-AI] Tool call:", call?.name, args);

    if (call?.name === "diagnose_current_image") {
      if (!context.jobId || context.jobId === "none") {
        return {
          type: "text",
          reply: "You don't have an active scan open. Please select and open an X-ray from your dashboard to analyze.",
          payload: null,
        };
      }
      const diagnosis = await diagnoseActiveImage({ jobId: context.jobId, userId, userQuestion: message });
      const hasMarker = Boolean(diagnosis.abnormalityDetected && diagnosis.marker);
      const reply = hasMarker
        ? `Fracture identified: **${diagnosis.condition}**. I have marked the fracture site below and on your image viewer:`
        : diagnosis.description;

      return {
        type: hasMarker ? "abnormality_result" : "text",
        reply,
        payload: { jobId: context.jobId, ...diagnosis },
      };
    }

    if (call?.name === "search_images") {
      const { searchKeyword, bodyPart } = args;
      const results = await queryFiles({ userId, query: searchKeyword, bodyPart });

      if (results.images.length === 0) {
        return {
          type: "text",
          reply: `I checked your scans, but found no images matching "${searchKeyword || bodyPart || message}".`,
          payload: null,
        };
      }
      return {
        type: "file_list_result",
        reply: `Found ${results.images.length} matching image(s). Select a scan to inspect:`,
        payload: results,
      };
    }

    return { type: "text", reply: msg.content || "How can I assist you with this scan?", payload: null };
  } catch (err) {
    console.error("[VEDA-AI] Execution failed:", err);
    return {
      type: "text",
      reply: "I am ready to help. Please ask your question about the active scan or your image library.",
      payload: null,
    };
  }
}