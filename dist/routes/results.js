"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = __importDefault(require("express"));
const supabase_js_1 = require("@supabase/supabase-js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.router = express_1.default.Router();
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
/**
 * GET /api/results/:campaignId
 * → Retorna todos los registros de vote_result_indexed para la campaña
 *   y también agrupa el conteo por option_index.
 */
exports.router.get("/:campaignId", async (req, res) => {
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
        const tally = {};
        votes?.forEach((v) => {
            const idx = v.option_index;
            tally[idx] = (tally[idx] || 0) + 1;
        });
        return res.status(200).json({ votes, tally });
    }
    catch (err) {
        console.error("results error:", err);
        return res.status(500).json({ error: err.message });
    }
});
