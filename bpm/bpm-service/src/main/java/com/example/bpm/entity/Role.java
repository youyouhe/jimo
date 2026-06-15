package com.example.bpm.entity;

import lombok.Data;

import java.time.Instant;

/**
 * Role entity mapped to the roles table.
 */
@Data
public class Role {

    private String id;
    private String code;
    private String name;
    private String description;
    private Boolean isSystem;
    private Instant createdAt;
}
