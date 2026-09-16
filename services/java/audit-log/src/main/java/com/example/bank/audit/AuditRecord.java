package com.example.bank.audit;

public record AuditRecord(long sequence, String actor, String action, String subject, String previousHash, String hash) {
}
