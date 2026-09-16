package com.example.bank.payments;

public final class SortCode {
    private SortCode() {}

    /** Six digits, optionally grouped as 12-34-56. */
    public static boolean isValid(String sortCode) {
        if (sortCode == null) return false;
        String digits = sortCode.replace("-", "");
        return digits.matches("\\d{6}");
    }

    public static String normalise(String sortCode) {
        if (!isValid(sortCode)) throw new IllegalArgumentException("invalid sort code");
        return sortCode.replace("-", "");
    }
}
