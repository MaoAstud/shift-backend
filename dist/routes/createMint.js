"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
// src/routes/createMint.ts
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
dotenv_1.default.config();
exports.router = express_1.default.Router();
// ──────────────────────────────────────────────────────────────
// 1) Conexión a Solana y PAYER Keypair
// ──────────────────────────────────────────────────────────────
const connection = new web3_js_1.Connection(process.env.SOLANA_RPC_URL, "confirmed");
// Carga tu keypair de backend para pagar rent y fees
const secretPath = path_1.default.resolve(__dirname, "../../secret/backend-keypair.json");
const secret = JSON.parse(fs_1.default.readFileSync(secretPath, "utf-8"));
const payer = web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secret));
// ──────────────────────────────────────────────────────────────
// 2) POST /api/create-mint
//    Genera un nuevo SPL‐mint (decimals=0) y devuelve su dirección
// ──────────────────────────────────────────────────────────────
exports.router.post("/", async (_req, res) => {
    try {
        // decimals = 0, autoridad de mint = payer.publicKey, sin freezeAuthority
        console.log("Creating new SPL mint...");
        const mintPubkey = await (0, spl_token_1.createMint)(connection, payer, payer.publicKey, null, 0);
        return res.status(200).json({
            mint: mintPubkey.toBase58(),
        });
    }
    catch (err) {
        console.error("create-mint error:", err);
        return res.status(500).json({ error: err.message });
    }
});
