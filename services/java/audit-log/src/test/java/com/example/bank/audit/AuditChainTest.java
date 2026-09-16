package com.example.bank.audit;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class AuditChainTest {
    @Test
    void freshChainVerifies() {
        AuditChain chain = new AuditChain();
        chain.append("u_agent", "case.view", "case-1");
        chain.append("u_supervisor", "case.approve", "case-1");
        assertTrue(chain.verify());
    }
}
