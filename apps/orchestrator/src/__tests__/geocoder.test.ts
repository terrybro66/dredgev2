import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios");

describe("geocodeToPolygon", () => {
  it("calls Nominatim with correct q parameter", async () => {
    // TODO
  });

  it("calls Nominatim with format: json and limit: 1", async () => {
    // TODO
  });

  it("sets User-Agent: dredge/1.0 header", async () => {
    // TODO
  });

  it("returns { poly, display_name } object", async () => {
    // TODO
  });

  it("returned poly has exactly 4 points for a bounding box", async () => {
    // TODO
  });

  it("all coordinate values in poly are numeric", async () => {
    // TODO
  });

  it("north/south and east/west values are in correct positions", async () => {
    // TODO
  });

  it("throws structured IntentError when result array is empty", async () => {
    // TODO
  });
});

describe("geocodeToCoordinates", () => {
  it("returns valid { lat, lon, display_name } object", async () => {
    // TODO
  });

  it("lat and lon are numbers, not strings", async () => {
    // TODO
  });

  it("throws structured IntentError when result array is empty", async () => {
    // TODO
  });
});
