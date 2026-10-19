// backend/api/src/routes/veda.js
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { processVedaMessage } from "../services/vedaService.js";

const router = Router();

const vedaChatSchema = {
  body: z.object({
    message: z.string().min(1),
    context: z.object({
      jobId: z.string().optional(),
      currentRoute: z.string().optional()
    }).optional(),
    history: z.array(z.object({
      role: z.string(),
      content: z.string()
    })).optional()
  })
};

/**
 * POST /api/veda/chat
 * Protected endpoint for user queries
 */
router.post(
  "/chat",
  requireAuth,
  validate(vedaChatSchema),
  async (req, res, next) => {
    try {
      const { message, context, history } = req.body;
      const userId = req.user.userId;

      const response = await processVedaMessage({
        userId,
        message,
        context: context || {},
        history: history || []
      });

      res.json(response);
    } catch (err) {
      console.error("[VEDA-API] Error in /chat route:", err);
      // Return graceful response instead of 500 to keep the chat connection smooth
      res.json({
        type: "text",
        reply: "I encountered a brief interruption while analyzing this scan. Please try asking again.",
        payload: null
      });
    }
  }
);


export default router;