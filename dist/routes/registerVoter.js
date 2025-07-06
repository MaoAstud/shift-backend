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
// 1) Supabase (Service Role)
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// 2) Solana Connection + PAYER
const connection = new web3_js_1.Connection(process.env.SOLANA_RPC_URL, "confirmed");
const secretPath = path_1.default.resolve(__dirname, "../../secret/backend-keypair.json");
const secret = JSON.parse(fs_1.default.readFileSync(secretPath, "utf-8"));
const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secret));
// 3) POST /api/register-voter
exports.router.post("/", async (req, res) => {
    try {
        const { voter_wallet, campaign_id } = req.body;
        if (!voter_wallet || !campaign_id) {
            return res
                .status(400)
                .json({ error: "Debe enviar voter_wallet y campaign_id" });
        }
        // A) Buscar UUID del votante
        const { data: voterRow, error: voterError } = await supabase
            .from("voter")
            .select("id")
            .eq("wallet_address", voter_wallet)
            .single();
        if (voterError || !voterRow) {
            return res.status(404).json({ error: "Votante no encontrado" });
        }
        const voter_id = voterRow.id;
        // B) Obtener mint de la campaña
        const { data: campRow, error: campError } = await supabase
            .from("campaign")
            .select("nft_mint")
            .eq("id", campaign_id)
            .single();
        if (campError || !campRow) {
            return res.status(404).json({ error: "Campaña no encontrada" });
        }
        const nftMintPubkey = new web3_js_1.PublicKey(campRow.nft_mint);
        // C) Comprobar si ya existe voter_campaign
        const { data: existingVC, error: existingError } = await supabase
            .from("voter_campaign")
            .select("id, token_sent")
            .eq("voter_id", voter_id)
            .eq("campaign_id", campaign_id)
            .maybeSingle();
        if (existingError)
            throw existingError;
        let vcId;
        if (existingVC) {
            vcId = existingVC.id;
            if (existingVC.token_sent) {
                // Ya se envió el token antes; no volvemos a mint
                return res.status(200).json({
                    message: "Token de voto ya fue emitido previamente",
                });
            }
            // Si existe pero token_sent=false, continuamos al mint
        }
        else {
            // Inserción normal con token_sent = false
            const { data: voterCampaignRow, error: vcError } = await supabase
                .from("voter_campaign")
                .insert([
                {
                    voter_id,
                    campaign_id,
                    has_voted: false,
                    token_sent: false,
                },
            ])
                .select("id")
                .single();
            if (vcError)
                throw vcError;
            vcId = voterCampaignRow.id;
        }
        // D) Crear/obtener ATA y mint
        const ata = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, payer, nftMintPubkey, new web3_js_1.PublicKey(voter_wallet));
        const mintIx = (0, spl_token_1.createMintToInstruction)(nftMintPubkey, ata.address, payer.publicKey, 1, [], spl_token_1.TOKEN_PROGRAM_ID);
        const tx = new web3_js_1.Transaction().add(mintIx);
        const signature = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [payer], { commitment: "confirmed" });
        // E) Marcar token_sent = true
        const { error: updateError } = await supabase
            .from("voter_campaign")
            .update({ token_sent: true })
            .eq("id", vcId);
        if (updateError)
            console.error("Error actualizando token_sent:", updateError);
        // F) Auditar emisión en vote_token_issuance
        const { error: vtiError } = await supabase
            .from("vote_token_issuance")
            .insert([
            {
                id: voter_id,
                campaign_id,
                mint_address: nftMintPubkey.toBase58(),
                tx_signature: signature,
            },
        ]);
        if (vtiError)
            console.error("Error en vote_token_issuance:", vtiError);
        // G) Responder
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
