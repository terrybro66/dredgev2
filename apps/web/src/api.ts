/**
 * Shared API base URL.
 *
 * Set VITE_API_URL in your .env file (or environment) to point at a non-local
 * backend. Defaults to the local dev server so nothing changes in development.
 *
 *   VITE_API_URL=https://api.example.com  # production
 *   VITE_API_URL=http://localhost:3001     # default (dev)
 */
export const API = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL ?? "http://localhost:3001";
