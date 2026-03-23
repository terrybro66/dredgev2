/**
 * apps/orchestrator/src/__mocks__/setup.ts
 *
 * Registered in vitest.config.ts as a setupFile.
 * Resets all Prisma mocks before every test automatically —
 * no manual beforeEach needed in individual test files.
 */

import { beforeEach } from "vitest";
import { resetPrismaMocks } from "@mocks/prisma";

beforeEach(() => {
  resetPrismaMocks();
});
