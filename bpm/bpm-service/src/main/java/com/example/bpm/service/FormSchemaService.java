package com.example.bpm.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Form definition and form data management.
 * Core functionality: filter fields based on taskDefinitionKey with per-node ACL.
 */
@Service
public class FormSchemaService {

    private final JdbcTemplate db;
    private final ObjectMapper json = new ObjectMapper();

    public FormSchemaService(JdbcTemplate db) { this.db = db; }

    // ====================== Form Definitions ======================

    /** Load complete form definition (with all node ACLs) */
    public Optional<FormDefinition> getDefinition(String formKey) {
        List<FormDefinition> list = db.query(
                "SELECT schema_json FROM form_definitions WHERE form_key=?",
                (rs, i) -> parse(rs.getString("schema_json")), formKey);
        return list.isEmpty() ? Optional.empty() : Optional.of(list.get(0));
    }

    /** Load form definition, filter fields by node + set mode (rw/r/-) */
    public Optional<FormDefinition> getDefinitionForNode(String formKey, String taskDefinitionKey) {
        Optional<FormDefinition> opt = getDefinition(formKey);
        if (opt.isEmpty()) return opt;

        FormDefinition def = opt.get();
        Map<String, String> acl = def.nodeAcl.getOrDefault(taskDefinitionKey, Map.of());

        // Filter + set mode
        List<FormField> filtered = new ArrayList<>();
        for (FormField f : def.fields) {
            String mode = acl.getOrDefault(f.name, "-");
            if ("-".equals(mode)) continue; // Hidden
            filtered.add(new FormField(f.name, f.label, f.type, f.required,
                    f.placeholder, f.unit, f.options, mode));
        }
        return Optional.of(new FormDefinition(def.formKey, def.name, filtered, def.nodeAcl));
    }

    // ====================== Form Data ======================

    /** Save or update form data */
    public void saveData(String processInstanceId, String formKey,
                         String taskDefinitionKey, Map<String, Object> formData) {
        // Upsert: each save overwrites the old record
        String newId = UUID.randomUUID().toString().substring(0, 8);
        int updated = db.update(
                "UPDATE form_data SET data_json=?, task_definition_key=?, updated_at=CURRENT_TIMESTAMP WHERE process_instance_id=? AND form_key=?",
                toJson(formData), taskDefinitionKey, processInstanceId, formKey);
        if (updated == 0) {
            db.update("INSERT INTO form_data (id,process_instance_id,form_key,task_definition_key,data_json) VALUES (?,?,?,?,?)",
                    newId, processInstanceId, formKey, taskDefinitionKey, toJson(formData));
        }
    }

    /** Read form data */
    public Optional<Map<String, Object>> getData(String processInstanceId, String formKey) {
        List<String> rows = db.query(
                "SELECT data_json FROM form_data WHERE process_instance_id=? AND form_key=?",
                (rs, i) -> rs.getString("data_json"), processInstanceId, formKey);
        if (rows.isEmpty() || rows.get(0) == null) return Optional.empty();
        return Optional.of(parseMap(rows.get(0)));
    }

    // ====================== Model Classes ======================

    public static class FormDefinition {
        public String formKey;
        public String name;
        public List<FormField> fields;
        public Map<String, Map<String, String>> nodeAcl;

        public FormDefinition() {}
        public FormDefinition(String formKey, String name, List<FormField> fields,
                              Map<String, Map<String, String>> nodeAcl) {
            this.formKey = formKey; this.name = name; this.fields = fields; this.nodeAcl = nodeAcl;
        }
    }

    public static class FormField {
        public String name;
        public String label;
        public String type;
        public boolean required;
        public String placeholder;
        public String unit;
        public List<String> options;
        public String mode; // rw / r / -

        public FormField() {}
        public FormField(String name, String label, String type, boolean required,
                         String placeholder, String unit, List<String> options, String mode) {
            this.name = name; this.label = label; this.type = type; this.required = required;
            this.placeholder = placeholder; this.unit = unit; this.options = options; this.mode = mode;
        }
    }

    // ====================== Internal Helpers ======================

    private FormDefinition parse(String jsonStr) {
        try { return json.readValue(jsonStr, FormDefinition.class); }
        catch (Exception e) { throw new RuntimeException("Form definition JSON parse failed", e); }
    }

    private Map<String, Object> parseMap(String jsonStr) {
        try { return json.readValue(jsonStr, new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { return Map.of(); }
    }

    private String toJson(Object obj) {
        try { return json.writeValueAsString(obj); }
        catch (Exception e) { return "{}"; }
    }
}
