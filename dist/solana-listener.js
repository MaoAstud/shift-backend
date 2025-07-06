"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateVoteResults = updateVoteResults;
// src/solana-listener.ts
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_js_1 = require("@supabase/supabase-js");
dotenv_1.default.config();
// 1) Supabase (service-role)
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// 2) Solana Connection
const connection = new web3_js_1.Connection(process.env.SOLANA_RPC_URL, "confirmed");
// 3) Backend wallet for AnchorProvider
const secretPath = path_1.default.resolve(__dirname, "../secret/backend-keypair.json");
const secret = JSON.parse(fs_1.default.readFileSync(secretPath, "utf-8"));
const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secret));
class SimpleWallet {
    constructor(payer) {
        this.payer = payer;
    }
    get publicKey() { return this.payer.publicKey; }
    async signTransaction(tx) { tx.partialSign(this.payer); return tx; }
    async signAllTransactions(txs) { txs.forEach(t => t.partialSign(this.payer)); return txs; }
}
const wallet = new SimpleWallet(payer);
// 4) Anchor Program
const shift_sc_json_1 = __importDefault(require("../idl/shift_sc.json"));
const provider = new anchor_1.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
    commitment: "confirmed",
});
const program = new anchor_1.Program(shift_sc_json_1.default, provider);
const progAny = program;
async function updateVoteResults() {
    console.log("🔄 Actualizando snapshots de votos on-chain…");
    const now = new Date();
    const nowIso = now.toISOString();
    // 0) Desactivar campañas pasadas
    const { error: deactivateErr } = await supabase
        .from("campaign")
        .update({ is_active: false })
        .lt("end_time", nowIso)
        .eq("is_active", true);
    if (deactivateErr) {
        console.error("Error desactivando campañas finalizadas:", deactivateErr);
    }
    else {
        console.log("✅ Campañas finalizadas desactivadas");
    }
    // A) Leer campañas activas y ya iniciadas
    const { data: camps, error: campsErr } = await supabase
        .from("campaign")
        .select("id, creator_wallet, title, start_time, end_time")
        .eq("is_active", true)
        .lte("start_time", nowIso);
    if (campsErr) {
        console.error("Error leyendo campañas activas/iniciadas:", campsErr);
        return;
    }
    for (const camp of camps) {
        try {
            // B) Derivar PDA y fetch on-chain
            const [pda] = web3_js_1.PublicKey.findProgramAddressSync([
                Buffer.from("campaign"),
                new web3_js_1.PublicKey(camp.creator_wallet).toBuffer(),
                Buffer.from(camp.title),
            ], progAny.programId);
            const acct = await progAny.account.campaign.fetch(pda);
            const votes = acct.votes.map((v) => BigInt(v.toString()));
            // C) Leer candidatos e índice on-chain
            const { data: cands, error: candsErr } = await supabase
                .from("campaign_candidate")
                .select("candidate_id, index_on_chain")
                .eq("campaign_id", camp.id);
            if (candsErr || !cands) {
                console.error(`Error leyendo candidates de ${camp.id}:`, candsErr);
                continue;
            }
            // D) Construir snapshots acumulativos
            const snapshots = cands.map(({ candidate_id, index_on_chain }) => ({
                campaign_id: camp.id,
                candidate_id,
                votes_count: Number(votes[index_on_chain] ?? 0),
                recorded_at: nowIso,
            }));
            // E) Insertar en vote_result_indexed
            const { error: insertErr } = await supabase
                .from("vote_result_indexed")
                .insert(snapshots);
            if (insertErr) {
                console.error(`Error insertando snapshot para ${camp.id}:`, insertErr);
            }
            else {
                console.log(`✅ Campaign ${camp.id}: ${snapshots.length} snapshots insertados.`);
            }
        }
        catch (err) {
            console.error(`Error procesando campaign ${camp.id}:`, err);
        }
    }
}
