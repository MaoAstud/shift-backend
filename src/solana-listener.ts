// src/solana-listener.ts
import fs from "fs";
import path from "path";
import { Connection, Keypair, Commitment, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// 1) Supabase (service-role)
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 2) Solana Connection
const connection = new Connection(
  process.env.SOLANA_RPC_URL!,
  "confirmed" as Commitment
);

// 3) Backend wallet for AnchorProvider
const secretPath = path.resolve(__dirname, "../secret/backend-keypair.json");
const secret = JSON.parse(fs.readFileSync(secretPath, "utf-8")) as number[];
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
class SimpleWallet {
  constructor(public payer: Keypair) {}
  get publicKey() { return this.payer.publicKey }
  async signTransaction(tx: any) { tx.partialSign(this.payer); return tx }
  async signAllTransactions(txs: any[]) { txs.forEach(t => t.partialSign(this.payer)); return txs }
}
const wallet = new SimpleWallet(payer);

// 4) Anchor Program
import idl from "../idl/shift_sc.json";
const provider = new AnchorProvider(connection, wallet, {
  preflightCommitment: "confirmed",
  commitment: "confirmed",
});
const program = new Program(idl as unknown as Idl, provider);
const progAny = program as any;

export async function updateVoteResults() {
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
  } else {
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

  for (const camp of camps!) {
    try {
      // B) Derivar PDA y fetch on-chain
      const [pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("campaign"),
          new PublicKey(camp.creator_wallet).toBuffer(),
          Buffer.from(camp.title),
        ],
        progAny.programId
      );
      const acct: any = await progAny.account.campaign.fetch(pda);
      const votes: bigint[] = acct.votes.map((v: any) => BigInt(v.toString()));

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
      } else {
        console.log(`✅ Campaign ${camp.id}: ${snapshots.length} snapshots insertados.`);
      }
    } catch (err) {
      console.error(`Error procesando campaign ${camp.id}:`, err);
    }
  }
}
