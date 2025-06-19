import fs from "fs";
import path from "path";
import express, { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  Commitment,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import dotenv from "dotenv";

dotenv.config();
export const router = express.Router();

// 1) Supabase (Service Role)
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2) Solana Connection + PAYER
const connection = new Connection(
  process.env.SOLANA_RPC_URL!,
  "confirmed" as Commitment
);
const secretPath = path.resolve(__dirname, "../../secret/backend-keypair.json");
const secret = JSON.parse(fs.readFileSync(secretPath, "utf-8")) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));

// 3) POST /api/register-voter
router.post("/", async (req: Request, res: Response) => {
  try {
    const { voter_wallet, campaign_id } = req.body as {
      voter_wallet: string;
      campaign_id: number;
    };
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
    const nftMintPubkey = new PublicKey(campRow.nft_mint as string);

    // C) Comprobar si ya existe voter_campaign
    const { data: existingVC, error: existingError } = await supabase
      .from("voter_campaign")
      .select("id, token_sent")
      .eq("voter_id", voter_id)
      .eq("campaign_id", campaign_id)
      .maybeSingle();
    if (existingError) throw existingError;

    let vcId: number;
    if (existingVC) {
      vcId = existingVC.id;
      if (existingVC.token_sent) {
        // Ya se envió el token antes; no volvemos a mint
        return res.status(200).json({
          message: "Token de voto ya fue emitido previamente",
        });
      }
      // Si existe pero token_sent=false, continuamos al mint
    } else {
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
      if (vcError) throw vcError;
      vcId = voterCampaignRow.id;
    }

    // D) Crear/obtener ATA y mint
    const ata = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      nftMintPubkey,
      new PublicKey(voter_wallet)
    );
    const mintIx = createMintToInstruction(
      nftMintPubkey,
      ata.address,
      payer.publicKey,
      1,
      [],
      TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(mintIx);
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [payer],
      { commitment: "confirmed" }
    );

    // E) Marcar token_sent = true
    const { error: updateError } = await supabase
      .from("voter_campaign")
      .update({ token_sent: true })
      .eq("id", vcId);
    if (updateError) console.error("Error actualizando token_sent:", updateError);

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
    if (vtiError) console.error("Error en vote_token_issuance:", vtiError);

    // G) Responder
    return res.status(200).json({
      message: "Votante registrado y NFT emitido correctamente",
      ata: ata.address.toBase58(),
      signature,
    });
  } catch (err: any) {
    console.error("register-voter error:", err);
    return res.status(500).json({ error: err.message });
  }
});
