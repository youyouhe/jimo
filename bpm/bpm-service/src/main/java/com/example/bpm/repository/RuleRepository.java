package com.example.bpm.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Resolution rules repository using JdbcTemplate.
 */
@Repository
public class RuleRepository {

    private final JdbcTemplate db;
    private final ObjectMapper json = new ObjectMapper();

    public RuleRepository(JdbcTemplate db) {
        this.db = db;
    }

    /**
     * Load a rule by name, returning strategy and parsed config JSON.
     */
    public Map<String, Object> findRule(String ruleName) {
        List<Map<String, Object>> list = db.query(
                "SELECT strategy, config_json FROM resolution_rules WHERE rule_name=?",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("strategy", rs.getString("strategy"));
                    m.put("config", parseConfig(rs.getString("config_json")));
                    return m;
                }, ruleName);
        return list.isEmpty() ? null : list.get(0);
    }

    /**
     * Load a rule with full detail: rule_name, label, strategy, and parsed config.
     */
    public Map<String, Object> findRuleDetail(String ruleName) {
        List<Map<String, Object>> list = db.query(
                "SELECT rule_name, label, strategy, config_json FROM resolution_rules WHERE rule_name=?",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("ruleName", rs.getString("rule_name"));
                    m.put("label", rs.getString("label"));
                    m.put("strategy", rs.getString("strategy"));
                    m.put("config", parseConfig(rs.getString("config_json")));
                    return m;
                }, ruleName);
        return list.isEmpty() ? null : list.get(0);
    }

    /**
     * List all registered rules (summary — no config).
     */
    public List<Map<String, Object>> listRules() {
        return db.query(
                "SELECT rule_name, label, strategy FROM resolution_rules ORDER BY rule_name",
                (rs, i) -> Map.<String, Object>of(
                        "ruleName", rs.getString("rule_name"),
                        "label", rs.getString("label"),
                        "strategy", rs.getString("strategy")
                ));
    }

    /**
     * Insert a new rule.
     */
    public void createRule(String ruleName, String label, String strategy, Map<String, Object> config) {
        db.update(
                "INSERT INTO resolution_rules (rule_name, label, strategy, config_json) VALUES (?, ?, ?, ?)",
                ruleName, label, strategy, serializeConfig(config));
    }

    /**
     * Update label, strategy, and config of an existing rule.
     */
    public void updateRule(String ruleName, String label, String strategy, Map<String, Object> config) {
        db.update(
                "UPDATE resolution_rules SET label=?, strategy=?, config_json=? WHERE rule_name=?",
                label, strategy, serializeConfig(config), ruleName);
    }

    /**
     * Delete a rule by primary key.
     */
    public void deleteRule(String ruleName) {
        db.update("DELETE FROM resolution_rules WHERE rule_name=?", ruleName);
    }

    /**
     * Check whether a rule with the given name exists.
     */
    public boolean ruleExists(String ruleName) {
        Integer count = db.queryForObject(
                "SELECT COUNT(*) FROM resolution_rules WHERE rule_name=?",
                Integer.class, ruleName);
        return count != null && count > 0;
    }

    // ---- helpers ----

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseConfig(String configJson) {
        if (configJson == null || configJson.isBlank()) return Map.of();
        try {
            return json.readValue(configJson, Map.class);
        } catch (Exception ignored) {
            return Map.of();
        }
    }

    private String serializeConfig(Map<String, Object> config) {
        if (config == null || config.isEmpty()) return "{}";
        try {
            return json.writeValueAsString(config);
        } catch (Exception e) {
            return "{}";
        }
    }
}
