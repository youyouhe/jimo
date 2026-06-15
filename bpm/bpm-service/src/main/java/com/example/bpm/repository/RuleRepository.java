package com.example.bpm.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Map;

/**
 * Resolution rules repository using JdbcTemplate.
 */
@Repository
public class RuleRepository {

    private final JdbcTemplate db;

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
                    Map<String, Object> m = new java.util.LinkedHashMap<>();
                    m.put("strategy", rs.getString("strategy"));
                    String configJson = rs.getString("config_json");
                    Map<String, Object> config = Map.of();
                    if (configJson != null) {
                        try {
                            config = new ObjectMapper().readValue(configJson, Map.class);
                        } catch (Exception ignored) {}
                    }
                    m.put("config", config);
                    return m;
                }, ruleName);
        return list.isEmpty() ? null : list.get(0);
    }

    /**
     * List all registered rules.
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
}
