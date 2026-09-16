import type { Applicant } from "./eligibility.ts";

/** Parses an untrusted request body. Throws on anything that is not exactly the expected shape. */
export function parseApplicant(body: unknown): Applicant {
  if (typeof body !== "object" || body === null) throw new TypeError("body must be an object");
  const b = body as Record<string, unknown>;
  if (typeof b.dateOfBirth !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.dateOfBirth)) throw new TypeError("dateOfBirth");
  if (typeof b.countryOfResidence !== "string" || b.countryOfResidence.length !== 2) throw new TypeError("countryOfResidence");
  for (const flag of ["hasUkAddress", "existingCustomer", "politicallyExposed"]) {
    if (typeof b[flag] !== "boolean") throw new TypeError(flag);
  }
  return {
    dateOfBirth: b.dateOfBirth,
    countryOfResidence: b.countryOfResidence.toUpperCase(),
    hasUkAddress: b.hasUkAddress as boolean,
    existingCustomer: b.existingCustomer as boolean,
    politicallyExposed: b.politicallyExposed as boolean,
  };
}
