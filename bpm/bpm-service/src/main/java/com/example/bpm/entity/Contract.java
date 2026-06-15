package com.example.bpm.entity;

import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;

/**
 * Contract entity mapped to the contracts table.
 */
@Data
public class Contract {

    private String id;
    private String contractNo;
    private String title;
    private String categoryId;
    private BigDecimal amount;
    private String currency;
    private String counterparty;
    private String ourParty;
    private String description;
    private String status;
    private String initiatorId;
    private String deptId;
    private String processInstanceId;
    private String formKey;
    private Map<String, Object> formData;
    private Instant createdAt;
    private Instant updatedAt;
}
