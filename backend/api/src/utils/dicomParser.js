import dicomParser from "dicom-parser";

/**
 * Extracts anatomical and modality metadata from a DICOM Buffer.
 * Tag (0018, 0015) = Body Part Examined
 * Tag (0008, 0060) = Modality
 */
export function extractDicomMetadata(buffer) {
  try {
    const dataSet = dicomParser.parseDicom(buffer);

    const bodyPart = dataSet.string("x00180015")?.toLowerCase() || null;
    const modality = dataSet.string("x00080060") || "X-ray";

    return {
      bodyPart: mapToStandardAnatomy(bodyPart),
      modality,
    };
  } catch (err) {
    // Standard image එකක් හෝ invalid DICOM එකක් නම් graceful fallback
    return { bodyPart: null, modality: "X-ray" };
  }
}

function mapToStandardAnatomy(rawPart) {
  if (!rawPart) return "unspecified";
  const p = rawPart.toLowerCase();
  if (p.includes("hand") || p.includes("wrist") || p.includes("finger")) return "hand";
  if (p.includes("leg") || p.includes("knee") || p.includes("tibia") || p.includes("femur") || p.includes("ankle") || p.includes("foot")) return "leg";
  if (p.includes("chest") || p.includes("thorax") || p.includes("lung")) return "chest";
  if (p.includes("skull") || p.includes("head") || p.includes("brain")) return "head";
  return p;
}