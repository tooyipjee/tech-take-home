package com.example.bank.txauth;

/**
 * What the audit log is told about a decision. Identifiers are masked before they get here:
 * the audit store is read by many more people than the account system is.
 */
public record AuditEvent(String requestId, String maskedCustomerId, String maskedAccountId, long amountCents, Decision.Outcome outcome, Decision.Reason reason) {
}
