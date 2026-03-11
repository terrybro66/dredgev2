import "dotenv/config";
// TODO: no console.log of key material under any circumstances

import express from "express";
import cors from "cors";
// TODO: import { queryRouter } from "./query"; — uncomment when step 10 is complete

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// TODO: app.use("/query", queryRouter); — uncomment when step 10 is complete

app.get("/health", (_req, res) => {
  // TODO: return { status: "ok", timestamp: new Date().toISOString() }
  res.json({ status: "TODO" });
});

app.listen(PORT, () => {
  console.log(`dredge orchestrator running on http://localhost:${PORT}`);
});
