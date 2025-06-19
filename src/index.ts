import express from "express";
import { json } from "body-parser";
import dotenv from "dotenv";
import cors from "cors";

import * as registerVoterRoute from "./routes/registerVoter";
import * as resultsRoute from "./routes/results";
import * as createMintRoute from "./routes/createMint";
import { updateVoteResults } from "./solana-listener";

dotenv.config();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  const app = express();
  app.use(json());
  app.use(cors());

  // → 1) Rutas del API
  app.use("/api/register-voter", registerVoterRoute.router);
  app.use("/api/create-mint", createMintRoute.router);

  // → 2) Tarea periódica: cada minuto
  setInterval(() => {
    updateVoteResults().catch(err => {
      console.error("Error en updateVoteResults:", err);
    });
  }, 30 * 1000); // 60 000 ms = 1 minuto
  console.log("⏱️  Tarea de actualización de resultados iniciada (cada 1min)");

  // → 3) Levantar servidor
  app.listen(PORT, () => {
    console.log(`🚀 Servidor API corriendo en http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
