package com.example.bank.txauth;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class InMemoryAuditSink implements AuditSink {
    private final List<AuditEvent> events = new ArrayList<>();

    @Override
    public void record(AuditEvent event) {
        events.add(event);
    }

    public List<AuditEvent> events() {
        return Collections.unmodifiableList(events);
    }
}
