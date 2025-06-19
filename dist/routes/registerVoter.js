"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const supabase_js_1 = require("@supabase/supabase-js");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.router = express_1.default.Router();
// ──────────────────────────────────────────────────────────────
// 1) Inicializar cliente Supabase (Service Role)
// ──────────────────────────────────────────────────────────────
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// ──────────────────────────────────────────────────────────────
// 2) Conexión a Solana y PAYER Keypair
// ──────────────────────────────────────────────────────────────
const connection = new web3_js_1.Connection(process.env.SOLANA_RPC_URL, "confirmed");
// Cargar PAYER desde secret/backend-keypair.json
const secretPath = path_1.default.resolve(__dirname, "../../secret/backend-keypair.json");
const secret = JSON.parse(fs_1.default.readFileSync(secretPath, "utf-8"));
const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secret));
// Programa ID de ShiftSc
const PROGRAM_ID = new web3_js_1.PublicKey(process.env.PROGRAM_ID);
// ──────────────────────────────────────────────────────────────
// 3) POST /api/register-voter
//    Body: { voter_wallet: string, campaign_id: number }
// ──────────────────────────────────────────────────────────────
exports.router.post("/", async (req, res) => {
    try {
        const { voter_wallet, campaign_id } = req.body;
        if (!voter_wallet || !campaign_id) {
            return res
                .status(400)
                .json({ error: "Debe enviar voter_wallet y campaign_id" });
        }
        // 1) Obtener mint de la campaña
        const { data: campaignRow, error: campError } = await supabase
            .from("campaign")
            .select("id, nft_mint")
            .eq("id", campaign_id)
            .single();
        if (campError || !campaignRow) {
            return res.status(404).json({ error: "Campaña no encontrada" });
        }
        const nftMintPubkey = new web3_js_1.PublicKey(campaignRow.nft_mint);
        // 2) Registrar el votante
        const { data: voterCampaignRow, error: vcError } = await supabase
            .from("voter_campaign")
            .insert([
            {
                voter_id: voter_wallet,
                campaign_id,
                has_voted: false,
            },
        ])
            .select("*")
            .single();
        if (vcError)
            throw vcError;
        // 3) Crear o obtener la ATA del votante
        const ata = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, payer, nftMintPubkey, new web3_js_1.PublicKey(voter_wallet));
        // 4) Mint 1 NFT a la ATA del votante
        const mintIx = (0, spl_token_1.createMintToInstruction)(nftMintPubkey, ata.address, payer.publicKey, 1, [], spl_token_1.TOKEN_PROGRAM_ID);
        const tx = new web3_js_1.Transaction().add(mintIx);
        const signature = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [payer], { commitment: "confirmed" });
        // 5) Insertar en vote_token_issuance
        const { error: vtiError } = await supabase
            .from("vote_token_issuance")
            .insert([
            {
                voter_id: voter_wallet,
                campaign_id,
                nft_mint: nftMintPubkey.toBase58(),
                tx_signature: signature,
            },
        ]);
        if (vtiError)
            throw vtiError;
        return res.status(200).json({
            message: "Votante registrado y NFT emitido correctamente",
            ata: ata.address.toBase58(),
            signature,
        });
    }
    catch (err) {
        console.error("register-voter error:", err);
        return res.status(500).json({ error: err.message });
    }
});
