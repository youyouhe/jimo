package com.example.bpm.entity;

import lombok.Data;

import java.time.Instant;

/**
 * Permission entity mapped to the permissions table.
 */
@Data
public class Permission {

    private String id;
    private String code;
    private String name;
    private String module;
    private Instant createdAt;
}
