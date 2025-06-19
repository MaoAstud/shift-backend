// src/routes/createMint.ts
import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Connection, Keypair, Commitment } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";

dotenv.config();

export const router = express.Router();

// ──────────────────────────────────────────────────────────────
// 1) Conexión a Solana y PAYER Keypair
// ──────────────────────────────────────────────────────────────
const connection = new Connection(
  process.env.SOLANA_RPC_URL!,
  "confirmed" as Commitment
);

// Carga tu keypair de backend para pagar rent y fees
const secretPath = path.resolve(__dirname, "../../secret/backend-keypair.json");
const secret = JSON.parse(fs.readFileSync(secretPath, "utf-8")) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

// ──────────────────────────────────────────────────────────────
// 2) POST /api/create-mint
//    Genera un nuevo SPL‐mint (decimals=0) y devuelve su dirección
// ──────────────────────────────────────────────────────────────
router.post("/", async (_req: Request, res: Response) => {
  try {
    // decimals = 0, autoridad de mint = payer.publicKey, sin freezeAuthority
    console.log("Creating new SPL mint...");
    const mintPubkey = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      0
    );

    return res.status(200).json({
      mint: mintPubkey.toBase58(),
    });
  } catch (err: any) {
    console.error("create-mint error:", err);
    return res.status(500).json({ error: err.message });
  }
});
