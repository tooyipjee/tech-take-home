package com.example.bank.txauth;

import java.util.Objects;

/** A customer's current account as the authorizer sees it. Amounts are in minor units (pence). */
public final class Account {
    public enum Status { ACTIVE, FROZEN, CLOSED }

    private final String accountId;
    private final String ownerCustomerId;
    private final Status status;
    private final long dailyLimitCents;
    private long availableBalanceCents;

    public Account(String accountId, String ownerCustomerId, Status status, long availableBalanceCents, long dailyLimitCents) {
        this.accountId = Objects.requireNonNull(accountId);
        this.ownerCustomerId = Objects.requireNonNull(ownerCustomerId);
        this.status = Objects.requireNonNull(status);
        this.availableBalanceCents = availableBalanceCents;
        this.dailyLimitCents = dailyLimitCents;
    }

    public String accountId() { return accountId; }
    public String ownerCustomerId() { return ownerCustomerId; }
    public Status status() { return status; }
    public long availableBalanceCents() { return availableBalanceCents; }
    public long dailyLimitCents() { return dailyLimitCents; }

    void debit(long amountCents) {
        availableBalanceCents -= amountCents;
    }
}
