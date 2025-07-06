"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = require("body-parser");
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const registerVoterRoute = __importStar(require("./routes/registerVoter"));
const createMintRoute = __importStar(require("./routes/createMint"));
const solana_listener_1 = require("./solana-listener");
dotenv_1.default.config();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
async function main() {
    const app = (0, express_1.default)();
    app.use((0, body_parser_1.json)());
    app.use((0, cors_1.default)());
    // → 1) Rutas del API
    app.use("/api/register-voter", registerVoterRoute.router);
    app.use("/api/create-mint", createMintRoute.router);
    // → 2) Tarea periódica: cada minuto
    setInterval(() => {
        (0, solana_listener_1.updateVoteResults)().catch(err => {
            console.error("Error en updateVoteResults:", err);
        });
    }, 60 * 1000); // 60 000 ms = 1 minuto
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
