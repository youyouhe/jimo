package com.example.bpm.entity;

import lombok.Data;

import java.time.Instant;

/**
 * Contract document entity mapped to the contract_documents table.
 */
@Data
public class ContractDocument {

    private String id;
    private String contractId;
    private String fileName;
    private String fileType;
    private String filePath;
    private Long fileSize;
    private String docKey;
    private Integer version;
    private String docType;
    private String uploadedBy;
    private Instant createdAt;
    private Instant updatedAt;
}
