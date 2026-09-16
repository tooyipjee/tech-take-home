package com.example.bank.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/** Five failures in fifteen minutes locks the customer out for fifteen minutes. */
public final class LoginAttempts {
    static final int MAX_FAILURES = 5;
    static final Duration WINDOW = Duration.ofMinutes(15);

    private record State(int failures, Instant firstFailure, Instant lockedUntil) {}

    private final Map<String, State> states = new HashMap<>();

    public boolean isLocked(String customerId, Instant now) {
        State s = states.get(customerId);
        return s != null && s.lockedUntil != null && now.isBefore(s.lockedUntil);
    }

    public void recordFailure(String customerId, Instant now) {
        State s = states.get(customerId);
        if (s == null || now.isAfter(s.firstFailure.plus(WINDOW))) {
            states.put(customerId, new State(1, now, null));
            return;
        }
        int failures = s.failures + 1;
        Instant lockedUntil = failures >= MAX_FAILURES ? now.plus(WINDOW) : null;
        states.put(customerId, new State(failures, s.firstFailure, lockedUntil));
    }

    public void recordSuccess(String customerId) {
        states.remove(customerId);
    }
}
