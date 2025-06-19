// src/solana-listener.ts
import fs from "fs";
import path from "path";
import { Connection, Keypair, Commitment, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Idl } from "@coral-xyz/anchor";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// 1) Supabase (service role)
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

/**
 * Cada minuto:
 *  - Lee cada campaña
 *  - Fetch on‐chain de `votes`
 *  - Compara con vote_result_indexed existente:
 *      * Inserta candidatos nuevos
 *      * Actualiza conteos cambiados
 *  - Si no hay cambios, no toca la BD
 */
export async function updateVoteResults() {
  console.log("🔄 Actualizando resultados on-chain en Supabase...");

  // A) Leer campañas
  const { data: camps, error: campsErr } = await supabase
    .from("campaign")
    .select("id, creator_wallet, title");
  if (campsErr) {
    console.error("Error leyendo campañas:", campsErr);
    return;
  }

  for (const camp of camps!) {
    try {
      // B) Derivar PDA y fetch on-chain
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("campaign"),
         new PublicKey(camp.creator_wallet).toBuffer(),
         Buffer.from(camp.title)],
        progAny.programId
      );
      const acct: any = await progAny.account.campaign.fetch(pda);
      const votes: bigint[] = acct.votes.map((v: any) => BigInt(v.toString()));

      // C) Leer candidatos e índices
      const { data: cands, error: candsErr } = await supabase
        .from("campaign_candidate")
        .select("candidate_id, index_on_chain")
        .eq("campaign_id", camp.id);
      if (candsErr || !cands) {
        console.error(`Error leyendo candidatos para ${camp.id}:`, candsErr);
        continue;
      }

      // D) Leer resultados existentes
      const { data: existing, error: existErr } = await supabase
        .from("vote_result_indexed")
        .select("candidate_id, votes_count")
        .eq("campaign_id", camp.id);
      if (existErr) {
        console.error(`Error leyendo resultados existentes para ${camp.id}:`, existErr);
        continue;
      }
      const existingMap = new Map(
        (existing || []).map((r) => [r.candidate_id, r.votes_count])
      );

      // E) Preparar listas de inserción y actualización
      const toInsert: Array<{
        campaign_id: string;
        candidate_id: string;
        votes_count: number;
        updated_at: string;
      }> = [];
      const toUpdate: Array<{
        candidate_id: string;
        votes_count: number;
      }> = [];

      for (const { candidate_id, index_on_chain } of cands) {
        const newCount = Number(votes[index_on_chain] || 0);
        const oldCount = existingMap.get(candidate_id);

        if (oldCount == null) {
          // Nuevo candidato: insert
          toInsert.push({
            campaign_id: camp.id,
            candidate_id,
            votes_count: newCount,
            updated_at: new Date().toISOString(),
          });
        } else if (oldCount !== newCount) {
          // Conteo cambiado: update
          toUpdate.push({ candidate_id, votes_count: newCount });
        }
      }

      if (toInsert.length === 0 && toUpdate.length === 0) {
        console.log(`— Sin cambios para campaña ${camp.id}`);
        continue;
      }

      // F) Ejecutar inserciones
      if (toInsert.length) {
        const { error: insErr } = await supabase
          .from("vote_result_indexed")
          .insert(toInsert);
        if (insErr) console.error(`Error insertando en ${camp.id}:`, insErr);
        else console.log(`Inserted ${toInsert.length} new rows for ${camp.id}`);
      }

      // G) Ejecutar updates
      await Promise.all(
        toUpdate.map(({ candidate_id, votes_count }) =>
          supabase
            .from("vote_result_indexed")
            .update({ votes_count, updated_at: new Date().toISOString() })
            .eq("campaign_id", camp.id)
            .eq("candidate_id", candidate_id)
            .then(({ error }) => {
              if (error) console.error(`Error actualizando ${candidate_id}:`, error);
            })
        )
      );
      if (toUpdate.length) {
        console.log(`Updated ${toUpdate.length} rows for ${camp.id}`);
      }
    } catch (err) {
      console.error(`Error en campaña ${camp.id}:`, err);
    }
  }
}
