import "dotenv/config";
import express from "express";
import cors from "cors";
import { queryRouter } from "./query";
import { loadDomains } from "./domains/registry";
import { loadAvailability } from "./availability";
import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");
import { exportRouter } from "./export";

loadAvailability(
  "police-uk",
  "https://data.police.uk/api/crimes-street-dates",
  (data) => (data as { date: string }[]).map((e) => e.date),
);

const app = express();
const PORT = process.env.PORT ?? 3001;

loadDomains();

app.use(cors());
app.use(express.json());
app.use("/query", queryRouter);
app.use("/query", exportRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`dredge orchestrator running on http://localhost:${PORT}`);
});
