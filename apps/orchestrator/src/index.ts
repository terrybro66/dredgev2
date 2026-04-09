import "dotenv/config";
import express from "express";
import cors from "cors";
import { queryRouter } from "./query";
import { loadDomains } from "./domains/registry";
import { setDefaultResultOrder } from "dns";
setDefaultResultOrder("ipv4first");
import { exportRouter } from "./export";
import { getRedisClient, checkRedisHealth } from "./redis";
import { workspaceRouter } from "./workspace";
import { registerDomainEmbeddings } from "./semantic/classifier";
import { prisma } from "./db";
import { adminRouter } from "./admin/discovery";

checkRedisHealth().then((healthy) => {
  if (!healthy) {
    console.warn(
      "Redis unavailable — falling back to in-memory mode for rate limiter and availability cache",
    );
  }
});

const app = express();
const PORT = process.env.PORT ?? 3001;

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
      "cinema listings",
      [
        "what's on at the cinema",
        "cinema listings in Bristol",
        "films showing near me",
        "what's on at Odeon",
        "movie times tonight",
        "films at Vue this weekend",
      ],
      prisma,
    ),
    registerDomainEmbeddings(
      "flood risk",
      [
        "flood risk in Bristol",
        "flooding near me",
        "is my area at risk of flooding",
        "flood warnings in Somerset",
        "Environment Agency flood alerts",
        "river levels near me",
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
    registerDomainEmbeddings(
      "transport",
      [
        "tube status in London",
        "transport in London",
        "TfL line status",
        "is the tube running",
        "London underground delays",
        "bus status London",
        "train delays London",
        "TfL disruptions",
      ],
      prisma,
    ),
    registerDomainEmbeddings(
      "population statistics",
      [
        "population of Bristol",
        "how many people live in Manchester",
        "UK population statistics",
        "ONS population estimates",
        "population data for London",
        "census data UK",
        "population growth in Birmingham",
        "demographic data England",
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
app.use("/admin", adminRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

async function start() {
  await loadDomains();

  // Register regulatory adapters (D.4/D.5/D.11)
  const { registerRegulatoryAdapter } = await import("./regulatory-adapter");
  const { foodBusinessGbAdapter } =
    await import("./domains/food-business-gb/index");
  const { huntingLicenceGbAdapter } =
    await import("./domains/hunting-licence-gb/index");
  registerRegulatoryAdapter(foodBusinessGbAdapter);
  registerRegulatoryAdapter(huntingLicenceGbAdapter);
  checkRedisHealth().catch((err) =>
    console.warn("Redis health check failed:", err),
  );
  app.listen(PORT, () => {
    console.log(`dredge orchestrator running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
