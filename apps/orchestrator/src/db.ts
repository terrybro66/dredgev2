import { PrismaClient } from "@dredge/database";

// TODO: attach to globalThis to survive hot reloads in development
// TODO: export single prisma instance

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

// TODO: guard with NODE_ENV check before assigning to globalThis
