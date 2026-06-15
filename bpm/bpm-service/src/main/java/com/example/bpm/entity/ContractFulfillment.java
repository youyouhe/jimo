package com.example.bpm.entity;

import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

/**
 * Contract fulfillment entity mapped to the contract_fulfillments table.
 */
@Data
public class ContractFulfillment {

    private String id;
    private String contractId;
    private Integer seq;
    private String type;
    private String title;
    private String description;
    private LocalDate planDate;
    private LocalDate actualDate;
    private BigDecimal amount;
    private String status;
    private String createdBy;
    private Instant createdAt;
    private Instant updatedAt;
}
