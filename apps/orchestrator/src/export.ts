import { Router, Request, Response } from "express";
import { stringify } from "csv-stringify";
import { prisma } from "./db";

export const exportRouter = Router();

exportRouter.get("/:id/export", async (req: Request, res: Response) => {
  const { format } = req.query;

  if (format !== "csv" && format !== "geojson") {
    return res.status(400).json({
      error: "unsupported_format",
      message: "format must be csv or geojson",
    });
  }

  const rows: any[] = await (prisma as any).queryResult.findMany({
    where: { query_id: req.params.id },
  });

  if (!rows || rows.length === 0) {
    return res.status(404).json({
      error: "not_found",
      message: "No results found for this query ID",
    });
  }

  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="dredge-export.csv"',
    );

    const stringifier = stringify({ header: true });
    stringifier.pipe(res);
    for (const row of rows) {
      stringifier.write(row);
    }
    stringifier.end();
    return;
  }

  if (format === "geojson") {
    res.setHeader("Content-Type", "application/geo+json");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="dredge-export.geojson"',
    );

    const features = rows.map((row: any) => {
      const { lat, lon, ...properties } = row;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties,
      };
    });

    return res.json({ type: "FeatureCollection", features });
  }
});
