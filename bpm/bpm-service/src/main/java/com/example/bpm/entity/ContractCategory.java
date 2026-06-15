package com.example.bpm.entity;

import lombok.Data;

/**
 * Contract category entity mapped to the contract_categories table.
 */
@Data
public class ContractCategory {

    private String id;
    private String name;
    private String code;
    private String approvalChain;
    private String amountRules;
    private String formKey;
    private Boolean enabled;
    private Integer sortOrder;
}
