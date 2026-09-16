package com.example.bank.txauth;

import java.util.Optional;

public interface AccountRepository {
    Optional<Account> findById(String accountId);
}
