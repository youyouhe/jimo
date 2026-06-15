package com.example.bpm.entity;

import lombok.Data;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Contract line item entity mapped to the contract_lines table.
 */
@Data
public class ContractLine {

    private String id;
    private String contractId;
    private Integer seq;
    private String itemName;
    private String specification;
    private String unit;
    private BigDecimal quantity;
    private BigDecimal unitPrice;
    private BigDecimal amount;
    private String remark;
    private Instant createdAt;
    private Instant updatedAt;
}
