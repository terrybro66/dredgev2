import "dotenv/config";
import express from "express";
import cors from "cors";
import { queryRouter } from "./query";
import { loadDomains } from "./domains/registry";
import { loadAvailability } from "./availability";
import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");
import { exportRouter } from "./export";
import { getRedisClient, checkRedisHealth } from "./redis";
import { workspaceRouter } from "./workspace";
import { registerDomainEmbeddings } from "./semantic/classifier";
import { prisma } from "./db";

loadAvailability(
  "police-uk",
  "https://data.police.uk/api/crimes-street-dates",
  (data) => (data as { date: string }[]).map((e) => e.date),
);

checkRedisHealth().then((healthy) => {
  if (!healthy) {
    console.warn(
      "Redis unavailable — falling back to in-memory mode for rate limiter and availability cache",
    );
  }
});

const app = express();
const PORT = process.env.PORT ?? 3001;

loadDomains();

if (process.env.DEEPSEEK_API_KEY) {
  Promise.all([
    registerDomainEmbeddings(
      "crime-uk",
      [
        "crime in London",
        "burglaries in Cambridge last month",
        "drug offences in Manchester",
        "violent crime in Bristol",
        "show me theft in Birmingham",
        "anti-social behaviour in Leeds",
        "robbery in Hackney last 3 months",
        "what crime happened near me",
        "criminal damage in Nottingham",
        "vehicle crime in Sheffield",
      ],
      prisma,
    ),
    registerDomainEmbeddings(
      "weather",
      [
        "weather in London",
        "temperature in Manchester this week",
        "will it rain in Edinburgh",
        "forecast for Bristol next month",
        "wind speed in Cardiff",
        "how hot was it in Glasgow last summer",
        "precipitation in Liverpool",
        "is it cold in Newcastle",
        "weather forecast for Leeds",
        "climate data for Birmingham",
      ],
      prisma,
    ),
  ])
    .then(() => {
      console.log(JSON.stringify({ event: "embeddings_seeded" }));
    })
    .catch((err) => {
      console.warn(
        JSON.stringify({ event: "embeddings_seed_failed", error: err.message }),
      );
    });
}

app.use(cors());
app.use(express.json());
app.use("/query", queryRouter);
app.use("/query", exportRouter);
app.use("/workspaces", workspaceRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`dredge orchestrator running on http://localhost:${PORT}`);
});
