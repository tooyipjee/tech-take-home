import type { Actor, CaseDetail } from '../contracts';
import { ROLE_SCOPES } from '../contracts';

const now = Date.now();
const hours = (n: number) => new Date(now + n * 3_600_000).toISOString();

/**
 * Two compliance officers, because four-eyes plus a compliance-only tier means a SAR raised by the
 * only officer in the directory could never be cleared.
 */
export const ACTOR_DIRECTORY: Actor[] = [
  {
    userId: 'u_reviewer',
    displayName: 'Priya Raman',
    role: 'kyc_reviewer',
    scopes: ROLE_SCOPES.kyc_reviewer,
  },
  {
    userId: 'u_lead',
    displayName: 'Tom Okafor',
    role: 'kyc_lead',
    scopes: ROLE_SCOPES.kyc_lead,
  },
  {
    userId: 'u_compliance',
    displayName: 'Dana Whitfield',
    role: 'compliance_officer',
    scopes: ROLE_SCOPES.compliance_officer,
  },
  {
    userId: 'u_compliance_2',
    displayName: 'Samir Haddad',
    role: 'compliance_officer',
    scopes: ROLE_SCOPES.compliance_officer,
  },
];

function mask(value: string, keep = 4): string {
  const tail = value.slice(-keep);
  return `${'•'.repeat(Math.max(4, value.length - keep))} ${tail}`.trim();
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, local.length - 1))}@${domain}`;
}

interface RawCase {
  id: string;
  reference: string;
  applicantName: string;
  country: string;
  status: CaseDetail['status'];
  riskBand: CaseDetail['riskBand'];
  riskScore: number;
  submittedHoursAgo: number;
  slaInHours: number;
  assignedTo: string | null;
  productTier: string;
  expectedMonthlyVolumeUsd: number;
  identity: { fullName: string; email: string; dateOfBirth: string; nationalId: string; address: string };
  documents: CaseDetail['documents'];
  screeningHits: CaseDetail['screeningHits'];
  riskSignals: CaseDetail['riskSignals'];
}

const RAW: RawCase[] = [
  {
    id: 'case_1041',
    reference: 'KYC-1041',
    applicantName: 'Marcus Delgado',
    country: 'US',
    status: 'pending_review',
    riskBand: 'low',
    riskScore: 22,
    submittedHoursAgo: -5,
    slaInHours: 19,
    assignedTo: null,
    productTier: 'Business Checking',
    expectedMonthlyVolumeUsd: 18_000,
    identity: {
      fullName: 'Marcus Delgado',
      email: 'marcus.delgado@northlinehvac.com',
      dateOfBirth: '1986-03-14',
      nationalId: '431-88-4821',
      address: '2140 Rockwell Ave, Cleveland, OH 44113',
    },
    documents: [
      { id: 'doc_1', type: 'passport', uploadedAt: hours(-5), verification: 'passed' },
      { id: 'doc_2', type: 'proof_of_address', uploadedAt: hours(-5), verification: 'passed' },
    ],
    screeningHits: [],
    riskSignals: [
      { label: 'Device reputation', points: 4, detail: 'Known-good device, no VPN' },
      { label: 'Business age', points: 8, detail: 'Registered 6 years ago in OH' },
      { label: 'Expected volume', points: 10, detail: '$18k/mo is typical for segment' },
    ],
  },
  {
    id: 'case_1042',
    reference: 'KYC-1042',
    applicantName: 'Ana Sofía Ferreira',
    country: 'PT',
    status: 'pending_review',
    riskBand: 'medium',
    riskScore: 48,
    submittedHoursAgo: -22,
    slaInHours: 2,
    assignedTo: null,
    productTier: 'Cross-border Payouts',
    expectedMonthlyVolumeUsd: 140_000,
    identity: {
      fullName: 'Ana Sofía Ferreira',
      email: 'a.ferreira@vialusa.pt',
      dateOfBirth: '1979-11-02',
      nationalId: 'PT-90114-7733',
      address: 'Rua do Almada 214, 4050-032 Porto',
    },
    documents: [
      { id: 'doc_3', type: 'passport', uploadedAt: hours(-22), verification: 'passed' },
      {
        id: 'doc_4',
        type: 'source_of_funds',
        uploadedAt: hours(-22),
        verification: 'manual_review',
        note: 'Bank statements in Portuguese; totals reconcile',
      },
    ],
    screeningHits: [
      {
        id: 'hit_1',
        provider: 'ComplyAdvantage',
        list: 'ADVERSE_MEDIA',
        matchedName: 'Ana S. Ferreira',
        matchStrength: 0.61,
        resolution: 'unresolved',
      },
    ],
    riskSignals: [
      { label: 'Cross-border corridor', points: 18, detail: 'PT → BR payouts' },
      { label: 'Expected volume', points: 20, detail: '$140k/mo, above segment median' },
      { label: 'Adverse media', points: 10, detail: 'Weak name match, 2019 article' },
    ],
  },
  {
    id: 'case_1043',
    reference: 'KYC-1043',
    applicantName: 'Viktor Osei',
    country: 'AE',
    status: 'pending_review',
    riskBand: 'high',
    riskScore: 81,
    submittedHoursAgo: -30,
    slaInHours: -6,
    assignedTo: null,
    productTier: 'Treasury',
    expectedMonthlyVolumeUsd: 900_000,
    identity: {
      fullName: 'Viktor Osei',
      email: 'v.osei@meridiantrade.ae',
      dateOfBirth: '1974-06-19',
      nationalId: 'AE-7741-20993',
      address: 'Office 1204, Burj Al Salam, Sheikh Zayed Rd, Dubai',
    },
    documents: [
      { id: 'doc_5', type: 'passport', uploadedAt: hours(-30), verification: 'passed' },
      {
        id: 'doc_6',
        type: 'source_of_funds',
        uploadedAt: hours(-28),
        verification: 'manual_review',
        note: 'Trade invoices from three unrelated counterparties',
      },
      { id: 'doc_7', type: 'proof_of_address', uploadedAt: hours(-30), verification: 'failed', note: 'Utility bill older than 90 days' },
    ],
    screeningHits: [
      {
        id: 'hit_2',
        provider: 'Dow Jones',
        list: 'PEP',
        matchedName: 'Viktor Osei',
        matchStrength: 0.88,
        resolution: 'unresolved',
      },
    ],
    riskSignals: [
      { label: 'PEP association', points: 30, detail: 'Close associate of a regional official' },
      { label: 'Expected volume', points: 26, detail: '$900k/mo treasury flows' },
      { label: 'Document quality', points: 15, detail: 'Proof of address failed verification' },
      { label: 'Corridor risk', points: 10, detail: 'AE → multiple high-risk jurisdictions' },
    ],
  },
  {
    id: 'case_1044',
    reference: 'KYC-1044',
    applicantName: 'Lena Vogt',
    country: 'DE',
    status: 'info_requested',
    riskBand: 'medium',
    riskScore: 44,
    submittedHoursAgo: -50,
    slaInHours: 26,
    assignedTo: 'u_reviewer',
    productTier: 'Business Checking',
    expectedMonthlyVolumeUsd: 62_000,
    identity: {
      fullName: 'Lena Vogt',
      email: 'lena@vogtdesign.de',
      dateOfBirth: '1991-01-27',
      nationalId: 'DE-5521-88410',
      address: 'Kastanienallee 12, 10435 Berlin',
    },
    documents: [{ id: 'doc_8', type: 'drivers_license', uploadedAt: hours(-50), verification: 'passed' }],
    screeningHits: [],
    riskSignals: [
      { label: 'Missing documents', points: 22, detail: 'No proof of address on file' },
      { label: 'Expected volume', points: 12, detail: '$62k/mo' },
    ],
  },
  {
    id: 'case_1045',
    reference: 'KYC-1045',
    applicantName: 'Ibrahim Nasser',
    country: 'LB',
    status: 'pending_review',
    riskBand: 'high',
    riskScore: 93,
    submittedHoursAgo: -12,
    slaInHours: 12,
    assignedTo: null,
    productTier: 'Cross-border Payouts',
    expectedMonthlyVolumeUsd: 310_000,
    identity: {
      fullName: 'Ibrahim Nasser',
      email: 'i.nasser@levantexport.lb',
      dateOfBirth: '1968-09-08',
      nationalId: 'LB-3390-11284',
      address: 'Rue Verdun 44, Beirut',
    },
    documents: [{ id: 'doc_9', type: 'passport', uploadedAt: hours(-12), verification: 'passed' }],
    screeningHits: [
      {
        id: 'hit_3',
        provider: 'Refinitiv',
        list: 'OFAC_SDN',
        matchedName: 'Ibrahim Nassr',
        matchStrength: 0.94,
        resolution: 'unresolved',
      },
      {
        id: 'hit_4',
        provider: 'Refinitiv',
        list: 'EU_CONSOLIDATED',
        matchedName: 'I. Nasser',
        matchStrength: 0.77,
        resolution: 'unresolved',
      },
    ],
    riskSignals: [
      { label: 'Sanctions match', points: 50, detail: 'Strong OFAC SDN name + DOB match' },
      { label: 'Jurisdiction', points: 25, detail: 'FATF increased-monitoring jurisdiction' },
      { label: 'Expected volume', points: 18, detail: '$310k/mo' },
    ],
  },
  {
    id: 'case_1046',
    reference: 'KYC-1046',
    applicantName: 'Grace Lindqvist',
    country: 'SE',
    status: 'approved',
    riskBand: 'low',
    riskScore: 16,
    submittedHoursAgo: -72,
    slaInHours: -48,
    assignedTo: 'u_lead',
    productTier: 'Business Checking',
    expectedMonthlyVolumeUsd: 9_500,
    identity: {
      fullName: 'Grace Lindqvist',
      email: 'grace@lindqvistceramics.se',
      dateOfBirth: '1994-04-30',
      nationalId: 'SE-19940430-2214',
      address: 'Sveavägen 88, 113 59 Stockholm',
    },
    documents: [
      { id: 'doc_10', type: 'passport', uploadedAt: hours(-72), verification: 'passed' },
      { id: 'doc_11', type: 'proof_of_address', uploadedAt: hours(-72), verification: 'passed' },
    ],
    screeningHits: [],
    riskSignals: [{ label: 'Low volume domestic', points: 6, detail: 'Sole trader, SEK domestic only' }],
  },
];

export function buildCases(): CaseDetail[] {
  return RAW.map((raw) => ({
    id: raw.id,
    reference: raw.reference,
    applicantName: raw.applicantName,
    country: raw.country,
    status: raw.status,
    riskBand: raw.riskBand,
    riskScore: raw.riskScore,
    submittedAt: hours(raw.submittedHoursAgo),
    slaDueAt: hours(raw.slaInHours),
    assignedTo: raw.assignedTo,
    unresolvedHits: raw.screeningHits.filter((hit) => hit.resolution === 'unresolved').length,
    revision: 1,
    productTier: raw.productTier,
    expectedMonthlyVolumeUsd: raw.expectedMonthlyVolumeUsd,
    identity: {
      fullName: raw.identity.fullName,
      email: maskEmail(raw.identity.email),
      dateOfBirth: `••••-••-${raw.identity.dateOfBirth.slice(-2)}`,
      nationalId: mask(raw.identity.nationalId),
      address: `${'•'.repeat(12)}, ${raw.identity.address.split(',').pop()?.trim() ?? ''}`,
      masked: true,
    },
    documents: raw.documents,
    screeningHits: raw.screeningHits,
    riskSignals: raw.riskSignals,
    timeline: [
      {
        id: `${raw.id}_ev_1`,
        at: hours(raw.submittedHoursAgo),
        actor: 'system',
        summary: `Application submitted; automated screening scored ${raw.riskScore} (${raw.riskBand}).`,
      },
    ],
  }));
}

export function unmaskedIdentity(caseId: string): CaseDetail['identity'] {
  const raw = RAW.find((item) => item.id === caseId);
  if (!raw) throw new Error(`unknown case ${caseId}`);
  return { ...raw.identity, masked: false };
}
