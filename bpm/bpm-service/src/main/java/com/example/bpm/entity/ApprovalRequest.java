package com.example.bpm.entity;

import lombok.Data;

import java.time.Instant;

/**
 * Generic approval request — one row per business record under approval for any
 * non-contract business_type (contracts keep their own {@code contracts} table).
 */
@Data
public class ApprovalRequest {
    private String id;
    private String businessType;
    private String businessKey;
    private String processKey;
    private String status;
    private String initiatorId;
    private String processInstanceId;
    private Instant createdAt;
    private Instant updatedAt;
}
