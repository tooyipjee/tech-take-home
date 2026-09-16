package com.example.bank.payments;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class SortCodeTest {
    @Test void acceptsGroupedForm() { assertTrue(SortCode.isValid("12-34-56")); }
    @Test void acceptsPlainForm() { assertTrue(SortCode.isValid("123456")); }
    @Test void rejectsLetters() { assertFalse(SortCode.isValid("12-34-5a")); }
    @Test void normalisesToDigits() { assertEquals("123456", SortCode.normalise("12-34-56")); }
}
