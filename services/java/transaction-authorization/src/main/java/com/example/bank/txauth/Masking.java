package com.example.bank.txauth;

/** Keeps the last four characters so an operator can correlate, hides the rest. */
public final class Masking {
    private Masking() {}

    public static String mask(String identifier) {
        if (identifier == null) return null;
        if (identifier.length() <= 4) return "****";
        return "*".repeat(identifier.length() - 4) + identifier.substring(identifier.length() - 4);
    }
}
