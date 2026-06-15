package com.example.bpm.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Department entity mapped to the departments table.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Department {

    private String id;
    private String name;
    private String parentId;
    private String leadId;
}
