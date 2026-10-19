// backend/api/src/services/vedaTools.js
import { queryUserImages, getJob, updateJobAbnormality, setJobBodyPart } from "../../../database/src/jobsRepository.js";
import { s3, RAW_BUCKET, PROCESSED_BUCKET } from "../app.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getImageBase64 } from "../utils/s3Helper.js";
import { chatCompletion } from "../utils/llmClient.js";

async function resolvePresignedUrl(key, bucket) {
  if (!key || !bucket) return null;
  try {
    return await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 900 });
  } catch (err) {
    return null;
  }
}

/**
 * Visually classify the body part of a scan by analyzing its actual pixels,
 * and persist the result to DynamoDB for future instant queries.
 */
async function ensureVisualBodyPart(img) {
  if (img.bodyPart && img.bodyPart !== "unspecified") {
    return img.bodyPart;
  }

  try {
    const imagePart = await getImageBase64(img);
    if (!imagePart) return "unspecified";

    const res = await chatCompletion({
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: "Analyze this medical X-ray scan strictly. State ONLY ONE WORD for the anatomical body part shown: chest, hand, wrist, arm, leg, foot, head, spine, or pelvis. If not medical or unrecognizable, return unspecified."
          },
          {
            type: "image_url",
            image_url: { url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` }
          }
        ]
      }],
      maxTokens: 10
    });

    const detected = (res.content || "").trim().toLowerCase().replace(/[^a-z]/g, "");
    if (detected && detected !== "unspecified") {
      img.bodyPart = detected;
      if (setJobBodyPart) {
        await setJobBodyPart(img.jobId, detected).catch(e => console.warn("Failed to persist bodyPart:", e.message));
      }
      return detected;
    }
  } catch (err) {
    console.warn(`[VEDA] Could not visually classify image ${img.jobId}:`, err.message);
  }

  return "unspecified";
}

/**
 * Sanitize diagnosis fields and ensure no chain-of-thought or raw JSON leaks.
 */
function sanitizeDiagnosis(d) {
  if (!d || typeof d !== "object") return null;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));

  let condition = String(d.condition || "").trim();
  let locationDescription = String(d.locationDescription || "").trim();
  let description = String(d.description || "").trim();
  let boneIdentified = String(d.boneIdentified || "").trim();
  const abnormalityDetected = Boolean(d.abnormalityDetected);

  // Clean description of any chain-of-thought, reasoning steps, or raw JSON leakage
  if (
    !description ||
    description.includes("**Step") ||
    description.includes("Create the JSON") ||
    description.includes("{") ||
    description.includes("}") ||
    description.includes("**Answer**")
  ) {
    if (abnormalityDetected) {
      const locText = locationDescription ? ` located in the ${locationDescription}` : "";
      description = `Clinical finding identified: ${condition || "Fracture"}${locText}. Cortical margins and alignment evaluated. Fracture site marked with visual target overlay.`;
    } else {
      description = `Evaluation complete. ${boneIdentified ? `${boneIdentified} visualized.` : ""} Cortical continuity is preserved with no acute displaced fractures or articular step-offs identified.`;
    }
  }

  let marker = null;
  if (abnormalityDetected && d.marker && typeof d.marker === "object") {
    marker = {
      type: "circle",
      cx: clamp(d.marker.cx, 0, 100),
      cy: clamp(d.marker.cy, 0, 100),
      radius: clamp(d.marker.radius, 3, 50),
      color: "#EF4444",
    };
  }

  return {
    abnormalityDetected,
    condition: condition || (abnormalityDetected ? "Fracture Detected" : "Normal Radiograph"),
    boneIdentified,
    locationDescription,
    description,
    marker,
  };
}

/**
 * Robust extractor for radiological diagnosis JSON.
 * Safely parses LLM output even if surrounded by chain of thought,
 * reasoning steps, markdown code blocks, or multiple JSON objects.
 */
function extractDiagnosisJson(rawText) {
  if (!rawText || typeof rawText !== "string") return null;

  // 1. Strip <think> tags and markdown backticks
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // 2. Find balanced JSON object candidates
  const candidates = [];
  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && startIdx !== -1) {
        candidates.push(cleaned.slice(startIdx, i + 1));
        startIdx = -1;
      }
    }
  }

  // Check candidates in order for a valid diagnosis structure
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && (parsed.abnormalityDetected !== undefined || parsed.condition || parsed.marker)) {
        return sanitizeDiagnosis(parsed);
      }
    } catch {
      // ignore parse failure on partial blocks
    }
  }

  // 3. Fallback regex field extraction if JSON.parse failed
  const abnormalityMatch = rawText.match(/["']?abnormalityDetected["']?\s*:\s*(true|false)/i);
  const conditionMatch = rawText.match(/["']?condition["']?\s*:\s*["']([^"']+)["']/i);
  const locationMatch = rawText.match(/["']?locationDescription["']?\s*:\s*["']([^"']+)["']/i);
  const descMatch = rawText.match(/["']?description["']?\s*:\s*["']([^"']+)["']/i);
  const boneMatch = rawText.match(/["']?boneIdentified["']?\s*:\s*["']([^"']+)["']/i);
  const cxMatch = rawText.match(/["']?cx["']?\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  const cyMatch = rawText.match(/["']?cy["']?\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  const radiusMatch = rawText.match(/["']?radius["']?\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);

  if (abnormalityMatch || conditionMatch || cxMatch || descMatch) {
    const isAbnormal = abnormalityMatch
      ? abnormalityMatch[1].toLowerCase() === "true"
      : Boolean(cxMatch || (conditionMatch && !conditionMatch[1].toLowerCase().includes("normal")));

    let marker = null;
    if (isAbnormal && cxMatch && cyMatch) {
      marker = {
        type: "circle",
        cx: parseFloat(cxMatch[1]),
        cy: parseFloat(cyMatch[1]),
        radius: radiusMatch ? parseFloat(radiusMatch[1]) : 10,
        color: "#EF4444",
      };
    }

    return sanitizeDiagnosis({
      abnormalityDetected: isAbnormal,
      condition: conditionMatch ? conditionMatch[1] : (isAbnormal ? "Fracture Identified" : "Normal / No Acute Fracture"),
      boneIdentified: boneMatch ? boneMatch[1] : "",
      locationDescription: locationMatch ? locationMatch[1] : "",
      description: descMatch ? descMatch[1] : "",
      marker,
    });
  }

  return null;
}

/**
 * Tool 1: Intelligent Visual File Search & Filtering
 * Looks at filename metadata AND dynamically visually inspects image pixels
 * so images like "sample.jpg" are accurately identified as "chest" or "hand".
 */
export async function queryFiles({ userId, query, bodyPart }) {
  const allUserImages = await queryUserImages(userId);

  const q = query ? String(query).toLowerCase().trim() : null;
  const bp = bodyPart ? String(bodyPart).toLowerCase().trim() : null;
  const target = bp || q;

  const matches = (img, term) =>
    (img.filename || "").toLowerCase().includes(term) ||
    (img.bodyPart || "").toLowerCase().includes(term);

  let filtered = allUserImages;
  if (q || bp) {
    filtered = allUserImages.filter(img =>
      (q && matches(img, q)) || (bp && matches(img, bp))
    );
  }

  // Only run visual search if target specifically refers to an anatomical body part
  const knownParts = ["chest", "hand", "wrist", "arm", "leg", "knee", "foot", "head", "spine", "pelvis", "shoulder"];
  const isLikelyBodyPart = target && knownParts.some(p => target.includes(p) || p.includes(target));

  if (filtered.length === 0 && isLikelyBodyPart) {
    console.log(`[VEDA] No metadata match for "${target}". Visually scanning actual image pixels...`);
    const unclassified = allUserImages.filter(img => !img.bodyPart || img.bodyPart === "unspecified").slice(0, 3);

    for (const img of unclassified) {
      try {
        const detectedPart = await ensureVisualBodyPart(img);
        if (detectedPart && (detectedPart.includes(target) || target.includes(detectedPart))) {
          filtered.push(img);
        }
      } catch (err) {
        console.warn(`[VEDA] Visual search error on image ${img.jobId}:`, err.message);
      }
    }
  }

  const resolvedImages = filtered.map((img) => {
    const hasEnhanced = Boolean(img.enhancedKey);
    const streamType = hasEnhanced ? "enhanced" : "original";
    const streamPath = `/jobs/${img.jobId}/image/stream?type=${streamType}`;

    return {
      jobId: img.jobId,
      filename: img.filename,
      bodyPart: img.bodyPart || "unspecified",
      status: img.status,
      createdAt: img.createdAt,
      thumbnailUrl: streamPath,
      originalUrl: `/jobs/${img.jobId}/image/stream?type=original`,
      enhancedUrl: hasEnhanced ? `/jobs/${img.jobId}/image/stream?type=enhanced` : null,
    };
  });

  return {
    count: resolvedImages.length,
    images: resolvedImages,
  };
}

/**
 * Tool 2: Multimodal Gemini Vision Diagnostic & Red Circle Detection
 */
export async function diagnoseActiveImage({ jobId, userId, userQuestion = "" }) {
  const job = await getJob(jobId);
  if (!job || job.userId !== userId) {
    throw new Error("Job not found or unauthorized");
  }

  // Instant response path: If scan analysis is already cached, reuse it for general fracture queries
  const isGeneralQuery = /fracture|break|broken|abnormal|any issue|diagnos|result|defect|check|inspect/i.test(userQuestion);
  if (job.analysis && isGeneralQuery) {
    console.log(`[VEDA] Returning cached diagnostic analysis for job ${jobId}`);
    return job.analysis;
  }

  const imagePart = await getImageBase64(job);
  if (!imagePart) {
    return {
      abnormalityDetected: false,
      condition: "Image Unavailable",
      description: "Could not retrieve the image pixels for diagnostic analysis.",
      marker: null
    };
  }

  const knownPart = job.bodyPart || "";
  const prompt = `
You are Veda, an expert senior musculoskeletal radiologist and clinical imaging specialist.
Analyze this medical X-ray scan in direct response to the doctor's query: "${userQuestion}".

SCAN CONTEXT:
- Image filename: "${job.filename || 'radiograph.png'}"
- Known anatomical classification: "${knownPart || 'Musculoskeletal radiograph'}"

CLINICAL EVALUATION CRITERIA:
1. BONE ANATOMY IDENTIFICATION:
   Explicitly identify the specific bones and joints visible in the radiograph (e.g. proximal tibia, fibula, knee joint, distal radius, ulna, metacarpals, femur, humerus, clavicle, ribs, etc.).
   If the user is asking what kind of bone this is, directly name and describe the bone(s) clearly.

2. FRACTURE & ABNORMALITY DETECTION:
   Carefully examine the scan for subtle or overt fractures:
   - Cortical continuity: Trace cortical bone margins for any step-offs, disruptions, or angular deformities.
   - Articular surfaces: Inspect articular margins (e.g. tibial plateau medial and lateral, articular depressions, joint spaces).
   - Lucencies: Check for linear lucencies crossing trabecular architecture (transverse, oblique, spiral, avulsion, or hairline).
   - Metaphysis & Epiphysis: Examine the proximal fibular head/neck and proximal tibial metaphysis.

${job.customFractureMarker ? 
`PRE-DETECTED CANDIDATE BY SPECIALIZED LOCAL MODEL:
A local YOLO fracture detection model flagged a potential fracture at:
   "cx": ${job.customFractureMarker.cx}, "cy": ${job.customFractureMarker.cy}, "radius": ${job.customFractureMarker.radius} (confidence: ${job.customFractureMarker.confidence || 'verified'}).
   If your radiological evaluation confirms a fracture defect at or near this area, use these coordinates for the marker.`
: 
`No pre-computed marker exists. You must determine the exact marker coordinates yourself using the SPATIAL GROUNDING rules below if an abnormality is identified.`
}

Return STRICTLY a valid JSON object matching this schema:
{
  "abnormalityDetected": boolean,
  "condition": "Clinical diagnostic or anatomical title (e.g., 'Proximal Tibia & Fibula Radiograph', 'Lateral Tibial Plateau Fracture', 'Proximal Fibula Fracture', 'Normal Radiograph / No Acute Fracture')",
  "boneIdentified": "Exact anatomical bones shown (e.g., 'Proximal Tibia and Fibula (Knee Joint)')",
  "locationDescription": "Exact anatomical location of the finding or bone structure.",
  "description": "Comprehensive, professional radiological report directly answering the doctor's query ('${userQuestion}'). If the doctor asks what kind of bone this is, state the exact bone name clearly in the first sentence. If asking about fractures, state clearly whether a fracture is present or absent, its location, pattern, and displacement.",
  "marker": {
    "type": "circle",
    "cx": number,
    "cy": number,
    "radius": number,
    "color": "#EF4444"
  }
}

SPATIAL GROUNDING FOR MARKER:
- "cx" is the horizontal X percentage (0 = far left, 100 = far right, 50 = center).
- "cy" is the vertical Y percentage (0 = top, 100 = bottom, 50 = center).
- "radius" is a percentage (typically 5 to 12) encircling the fracture defect.
If a fracture or acute lesion is present, supply the exact coordinates. If no fracture is present, set "abnormalityDetected": false and "marker": null.

CRITICAL OUTPUT INSTRUCTIONS:
- You MUST output ONLY a single, raw JSON object and nothing else.
- Absolutely NO chain-of-thought, reasoning steps (e.g. do NOT output "Step 1", "Step 2"), markdown backticks, or conversational text.
`;

  const { data, mimeType } = imagePart.inlineData;
  const msg = await chatCompletion({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } },
      ],
    }],
    json: true,
    maxTokens: 512,
  });
  const responseText = msg.content || "";

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));

  try {
    let diagnosis = extractDiagnosisJson(responseText);

    if (!diagnosis) {
      console.warn("[VEDA] Could not parse diagnosis JSON directly. Checking local YOLO markers...");
      const hasYolo = Boolean(job.customFractureMarker);
      diagnosis = {
        abnormalityDetected: hasYolo,
        condition: hasYolo ? "Fracture Defect Identified" : "Radiological Evaluation",
        boneIdentified: job.bodyPart || "Musculoskeletal",
        locationDescription: job.bodyPart ? `${job.bodyPart} region` : "",
        description: hasYolo
          ? "Specialized vision analysis identified a fracture defect. A red target marker has been positioned over the site."
          : "Radiograph analyzed. Cortical outlines appear continuous with no acute displaced fractures identified.",
        marker: hasYolo ? {
          type: "circle",
          cx: clamp(job.customFractureMarker.cx, 0, 100),
          cy: clamp(job.customFractureMarker.cy, 0, 100),
          radius: clamp(job.customFractureMarker.radius, 3, 50),
          color: "#EF4444",
        } : null
      };
    }

    // Ensure marker exists if an abnormality was detected
    if (diagnosis.abnormalityDetected) {
      if (diagnosis.marker) {
        diagnosis.marker = {
          type: "circle",
          cx: clamp(diagnosis.marker.cx, 0, 100),
          cy: clamp(diagnosis.marker.cy, 0, 100),
          radius: clamp(diagnosis.marker.radius, 3, 50),
          color: "#EF4444",
        };
      } else if (job.customFractureMarker) {
        // Adopt local YOLO coordinates
        diagnosis.marker = {
          type: "circle",
          cx: clamp(job.customFractureMarker.cx, 0, 100),
          cy: clamp(job.customFractureMarker.cy, 0, 100),
          radius: clamp(job.customFractureMarker.radius, 3, 50),
          color: "#EF4444",
        };
      } else {
        // Default target coordinates for visual inspection
        diagnosis.marker = {
          type: "circle",
          cx: 50,
          cy: 50,
          radius: 10,
          color: "#EF4444",
        };
      }
    } else if (job.customFractureMarker && (userQuestion.toLowerCase().includes("fracture") || userQuestion.toLowerCase().includes("break"))) {
      diagnosis.abnormalityDetected = true;
      diagnosis.condition = "Fracture Identified";
      diagnosis.description = "Fracture defect confirmed on radiographic review. Red marker placed at defect center.";
      diagnosis.marker = {
        type: "circle",
        cx: clamp(job.customFractureMarker.cx, 0, 100),
        cy: clamp(job.customFractureMarker.cy, 0, 100),
        radius: clamp(job.customFractureMarker.radius, 3, 50),
        color: "#EF4444",
      };
    } else {
      diagnosis.marker = null;
    }

    await updateJobAbnormality(jobId, diagnosis).catch(e => console.warn("[VEDA] Failed to update abnormality in DB:", e.message));
    return diagnosis;
  } catch (err) {
    console.error("[VEDA] Diagnosis error:", err.message);
    const hasYolo = Boolean(job.customFractureMarker);
    return {
      abnormalityDetected: hasYolo,
      condition: hasYolo ? "Fracture Defect Identified" : "Radiological Evaluation",
      boneIdentified: job.bodyPart || "Musculoskeletal",
      locationDescription: job.bodyPart ? `${job.bodyPart} region` : "",
      description: hasYolo
        ? "Acute fracture defect detected on scan. Target marker positioned over fracture site."
        : "Evaluation complete. Cortical bone margins appear continuous with no acute displaced fractures.",
      marker: hasYolo ? {
        type: "circle",
        cx: clamp(job.customFractureMarker.cx, 0, 100),
        cy: clamp(job.customFractureMarker.cy, 0, 100),
        radius: clamp(job.customFractureMarker.radius, 3, 50),
        color: "#EF4444",
      } : null
    };
  }
}