package com.example.bank.txauth;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

/** How much each account has already spent today. In production this is a ledger query. */
public final class DailySpendTracker {
    private final Map<String, Long> spentToday = new HashMap<>();
    private LocalDate day;

    public DailySpendTracker(LocalDate today) {
        this.day = today;
    }

    public long spentToday(String accountId, LocalDate today) {
        rollover(today);
        return spentToday.getOrDefault(accountId, 0L);
    }

    public void record(String accountId, long amountCents, LocalDate today) {
        rollover(today);
        spentToday.merge(accountId, amountCents, Long::sum);
    }

    private void rollover(LocalDate today) {
        if (!today.equals(day)) {
            spentToday.clear();
            day = today;
        }
    }
}
