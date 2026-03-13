import { FallbackInfo } from "@dredge/schemas";

export interface RecoveryResult {
  data: unknown[];
  fallback: FallbackInfo;
}

/**
 * Stub — returns null until step 5a implements the real strategies.
 */
export async function recoverFromEmpty(
  _plan: any,
  _locationArg: string,
  _prisma: any,
): Promise<RecoveryResult | null> {
  return null;
}
