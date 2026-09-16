package com.example.bank.txauth;

public interface AuditSink {
    void record(AuditEvent event);
}
