package com.example.bank.txauth;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class AuthorizationServiceTest {

    @Test
    void approvesAnOrdinaryDebit() {
        Clock clock = Clock.fixed(Instant.parse("2026-09-18T17:30:00Z"), ZoneOffset.UTC);
        InMemoryAccountRepository accounts = new InMemoryAccountRepository()
                .add(new Account("acc-1001", "cust-42", Account.Status.ACTIVE, 50_000, 100_000));
        AuthorizationService service = new AuthorizationService(
                accounts, new DailySpendTracker(LocalDate.now(clock)), new InMemoryAuditSink(), clock);

        Decision decision = service.authorize(
                new AuthorizationRequest("req-1", "cust-42", "acc-1001", 2_500, "GBP", "groceries"));

        assertTrue(decision.isApproved());
    }
}
