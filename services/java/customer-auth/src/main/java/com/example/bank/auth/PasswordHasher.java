package com.example.bank.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;

/** Salted SHA-256, iterated. Illustrative only: production would use a memory-hard KDF. */
public final class PasswordHasher {
    private static final int ITERATIONS = 10_000;
    private final SecureRandom random = new SecureRandom();

    public String hash(char[] password) {
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt) + "$" + Base64.getEncoder().encodeToString(digest(salt, password));
    }

    public boolean verify(char[] password, String stored) {
        String[] parts = stored.split("\\$");
        if (parts.length != 2) return false;
        byte[] salt = Base64.getDecoder().decode(parts[0]);
        byte[] expected = Base64.getDecoder().decode(parts[1]);
        return MessageDigest.isEqual(expected, digest(salt, password));
    }

    private static byte[] digest(byte[] salt, char[] password) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] current = new String(password).getBytes(StandardCharsets.UTF_8);
            for (int i = 0; i < ITERATIONS; i++) {
                md.reset();
                md.update(salt);
                current = md.digest(current);
            }
            return current;
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
