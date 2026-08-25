/**
 * Importing this module registers every capability. The API host imports it once
 * at boot; nothing else in the system may import capability handlers directly.
 */
export * from "./refunds.ts";
export * from "./flags.ts";
export * from "./queue.ts";
