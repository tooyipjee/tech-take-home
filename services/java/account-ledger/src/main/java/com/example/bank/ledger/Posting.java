package com.example.bank.ledger;

import java.time.Instant;

/** One immutable ledger line. Credits are positive, debits negative. */
public record Posting(String postingId, String accountId, long amountCents, Instant at, String reference) {
}
