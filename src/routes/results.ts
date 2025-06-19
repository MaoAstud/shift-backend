import express, { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

export const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * GET /api/results/:campaignId
 * → Retorna todos los registros de vote_result_indexed para la campaña
 *   y también agrupa el conteo por option_index.
 */
router.get("/:campaignId", async (req: Request, res: Response) => {
  try {
    const campaign_id = Number(req.params.campaignId);
    if (isNaN(campaign_id)) {
      return res.status(400).json({ error: "CampaignId inválido" });
    }

    // 1) Leer todos los votos de vote_result_indexed para esa campaña
    const { data: votes, error: votesError } = await supabase
      .from("vote_result_indexed")
      .select("id, voter_address, option_index, occurred_at")
      .eq("campaign_id", campaign_id);

    if (votesError) {
      throw votesError;
    }

    // 2) Agrupar por option_index para devolver conteo
    const tally: Record<number, number> = {};
    votes?.forEach((v: any) => {
      const idx = v.option_index as number;
      tally[idx] = (tally[idx] || 0) + 1;
    });

    return res.status(200).json({ votes, tally });
  } catch (err: any) {
    console.error("results error:", err);
    return res.status(500).json({ error: err.message });
  }
});
