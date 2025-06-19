"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSolanaListener = startSolanaListener;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_js_1 = require("@supabase/supabase-js");
dotenv_1.default.config();
// ──────────────────────────────────────────────────────────────
// 1) Inicializar Supabase (Service Role)
// ──────────────────────────────────────────────────────────────
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// ──────────────────────────────────────────────────────────────
// 2) Conexión a Solana
// ──────────────────────────────────────────────────────────────
const connection = new web3_js_1.Connection(process.env.SOLANA_RPC_URL, "confirmed");
// ──────────────────────────────────────────────────────────────
// 3) Cargar wallet del backend (payer) desde JSON y crear interfaz de Wallet
// ──────────────────────────────────────────────────────────────
const secretPath = path_1.default.resolve(__dirname, "../secret/backend-keypair.json");
const secret = JSON.parse(fs_1.default.readFileSync(secretPath, "utf-8"));
const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secret));
// Implementación mínima de Wallet para AnchorProvider
class SimpleWallet {
    constructor(payer) {
        this.payer = payer;
    }
    get publicKey() {
        return this.payer.publicKey;
    }
    async signTransaction(tx) {
        tx.partialSign(this.payer);
        return tx;
    }
    async signAllTransactions(txs) {
        txs.forEach(tx => tx.partialSign(this.payer));
        return txs;
    }
}
const wallet = new SimpleWallet(payer);
// ──────────────────────────────────────────────────────────────
// 4) Cargar IDL y crear Provider + Program
// ──────────────────────────────────────────────────────────────
const shift_sc_json_1 = __importDefault(require("../idl/shift_sc.json"));
const provider = new anchor_1.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
    commitment: "confirmed",
});
const program = new anchor_1.Program(shift_sc_json_1.default, provider);
/**
 * startSolanaListener:
 *  1) Se suscribe a los logs donde aparezca program.programId
 *  2) Cuando llega un log, busca la instrucción "castVote"
 *  3) Extrae: campaignPda, voterPubkey, optionIndex
 *  4) Actualiza en Supabase:
 *     a) voter_campaign  → set has_voted = true, voted_at = now()
 *     b) vote_result_indexed → inserta registro de voto
 */
async function startSolanaListener() {
    console.log("🔍 Iniciando listener on-chain para castVote...");
    connection.onLogs(program.programId, async (logs, ctx) => {
        try {
            const signature = logs.signature;
            // 1) Obtener la transacción para decodificar instrucciones
            const tx = await connection.getTransaction(signature, { commitment: "confirmed" });
            if (!tx?.transaction)
                return;
            const message = tx.transaction.message;
            for (const ix of message.instructions) {
                // 2a) Filtrar por programa usando programIdIndex
                const ixProgramId = message.accountKeys[ix.programIdIndex];
                if (!ixProgramId.equals(program.programId))
                    continue;
                // 2b) Decodificar la data de la instrucción (base64)
                const rawData = Buffer.from(ix.data, "base64");
                const decoded = program.coder.instruction.decode(rawData);
                if (decoded.name !== "castVote")
                    continue;
                // 3) Extraer argumentos
                const optionIndex = decoded.args.optionIndex.toNumber();
                // 4) Extraer cuentas de message.accountKeys
                const voterPubkey = message.accountKeys[ix.accounts[1]].toBase58();
                const campaignPdaPubkey = message.accountKeys[ix.accounts[0]].toBase58();
                const occurred_at = new Date().toISOString();
                console.log(`🗳️ castVote → voter=${voterPubkey}, campaign=${campaignPdaPubkey}, option=${optionIndex}`);
                // 5) Actualizar tabla voter_campaign
                const { error: vcError } = await supabase
                    .from("voter_campaign")
                    .update({ has_voted: true, voted_at: occurred_at })
                    .eq("voter_id", voterPubkey)
                    .eq("campaign_id", campaignPdaPubkey);
                if (vcError)
                    console.error("Error actualizando voter_campaign:", vcError);
                // 6) Insertar en vote_result_indexed
                const { error: vrError } = await supabase
                    .from("vote_result_indexed")
                    .insert([{
                        campaign_id: campaignPdaPubkey,
                        voter_address: voterPubkey,
                        option_index: optionIndex,
                        occurred_at,
                    }]);
                if (vrError)
                    console.error("Error insertando vote_result_indexed:", vrError);
                else
                    console.log("✅ Voto indexado en Supabase.");
            }
        }
        catch (err) {
            console.error("Error en onLogs callback:", err);
        }
    }, "confirmed");
}
