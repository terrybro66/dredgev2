import "dotenv/config";
import express from "express";
import cors from "cors";
import { queryRouter } from "./query";
import { loadDomains } from "./domains/registry";

const app = express();
const PORT = process.env.PORT ?? 3001;

loadDomains();

app.use(cors());
app.use(express.json());
app.use("/query", queryRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`dredge orchestrator running on http://localhost:${PORT}`);
});