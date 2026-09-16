export type Applicant = {
  dateOfBirth: string; // ISO date
  countryOfResidence: string;
  hasUkAddress: boolean;
  existingCustomer: boolean;
  politicallyExposed: boolean;
};

export type Eligibility = { eligible: true } | { eligible: false; reasons: string[] };

export function ageOn(dateOfBirth: string, today: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date(today);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function checkEligibility(applicant: Applicant, today: string): Eligibility {
  const reasons: string[] = [];
  if (ageOn(applicant.dateOfBirth, today) < 18) reasons.push("under_18");
  if (applicant.countryOfResidence !== "GB") reasons.push("non_uk_resident");
  if (!applicant.hasUkAddress) reasons.push("no_uk_address");
  if (applicant.politicallyExposed) reasons.push("manual_review_pep");
  return reasons.length === 0 ? { eligible: true } : { eligible: false, reasons };
}
