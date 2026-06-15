package com.example.bpm.service;

import org.flowable.engine.RepositoryService;
import org.flowable.engine.repository.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * BPMN deployment and version history management.
 * Deploys BPMN via Flowable RepositoryService and tracks versions in version_history table.
 */
@Service
public class DeploymentService {

    private final RepositoryService repo;
    private final JdbcTemplate db;

    public DeploymentService(RepositoryService repo, JdbcTemplate db) {
        this.repo = repo; this.db = db;
    }

    /** Deploy new BPMN version (bpmnXml is the XML text content) */
    public Map<String, Object> deploy(String processKey, String resourceName,
                                       String bpmnXml, String changeLog) {
        // Deploy to Flowable
        Deployment deployment = repo.createDeployment()
                .addString(resourceName, bpmnXml)
                .name(processKey + " v?" + " -- " + changeLog)
                .deploy();

        // Look up the version number assigned by Flowable
        ProcessDefinition pd = repo.createProcessDefinitionQuery()
                .deploymentId(deployment.getId()).singleResult();

        int version = pd.getVersion();

        // Write to business version history
        String id = UUID.randomUUID().toString().subSequence(0, 8).toString();
        db.update("INSERT INTO version_history (id, process_key, version, deployment_id, change_log) VALUES (?,?,?,?,?)",
                id, processKey, version, deployment.getId(), changeLog);

        return Map.of(
                "deploymentId", deployment.getId(),
                "processKey", processKey,
                "version", version,
                "changeLog", changeLog,
                "message", "Process " + processKey + " v" + version + " deployed"
        );
    }

    /** Ensure Flowable versions have records in version_history */
    private void ensureVersionHistory(String processKey) {
        for (ProcessDefinition pd : repo.createProcessDefinitionQuery()
                .processDefinitionKey(processKey).list()) {
            Integer exists = db.queryForObject(
                    "SELECT COUNT(*) FROM version_history WHERE process_key=? AND version=? AND deployment_id=?",
                    Integer.class, pd.getKey(), pd.getVersion(), pd.getDeploymentId());
            if (exists == null || exists == 0) {
                db.update("INSERT INTO version_history (id, process_key, version, deployment_id, change_log) VALUES (?,?,?,?,?)",
                        UUID.randomUUID().toString().substring(0, 8),
                        pd.getKey(), pd.getVersion(), pd.getDeploymentId(), "Initial version (auto-deployed)");
            }
        }
    }

    /** List all historical versions for a process */
    public List<Map<String, Object>> versions(String processKey) {
        ensureVersionHistory(processKey);

        // Query all version_history records
        List<Map<String, Object>> rows = db.query(
                "SELECT version, deployment_id, change_log, deployed_at FROM version_history WHERE process_key=? ORDER BY version DESC",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("version", rs.getInt("version"));
                    m.put("deploymentId", rs.getString("deployment_id"));
                    m.put("changeLog", rs.getString("change_log"));
                    m.put("deployedAt", rs.getTimestamp("deployed_at"));
                    m.put("runningCount", 0);
                    return m;
                }, processKey);

        // Count running instances per version
        for (Map<String, Object> row : rows) {
            String depId = (String) row.get("deploymentId");
            Integer count = db.queryForObject(
                    "SELECT COUNT(*) FROM act_hi_procinst pi " +
                    "JOIN act_re_procdef pd ON pi.PROC_DEF_ID_ = pd.ID_ " +
                    "WHERE pd.DEPLOYMENT_ID_ = ?",
                    Integer.class, depId);
            row.put("runningCount", count != null ? count : 0);
        }

        return rows;
    }

    /** Look up the version number for a running instance */
    public Map<String, Object> instanceVersion(String processInstanceId) {
        var list = db.query(
                "SELECT pd.VERSION_ AS ver, pd.KEY_ AS pkey, pd.NAME_ AS pname, " +
                "v.change_log " +
                "FROM act_hi_procinst pi " +
                "JOIN act_re_procdef pd ON pi.PROC_DEF_ID_ = pd.ID_ " +
                "LEFT JOIN version_history v ON v.deployment_id = pd.DEPLOYMENT_ID_ AND v.version = pd.VERSION_ " +
                "WHERE pi.PROC_INST_ID_ = ?",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("processInstanceId", processInstanceId);
                    m.put("processKey", rs.getString("pkey"));
                    m.put("version", rs.getInt("ver"));
                    m.put("processName", rs.getString("pname"));
                    String log = rs.getString("change_log");
                    m.put("changeLog", log != null ? log : "(Initial version, auto-deployed)");
                    return m;
                }, processInstanceId);
        return list.isEmpty() ? Map.of("error", "Instance not found") : list.get(0);
    }

    /** Version overview: latest version per processKey + instance counts per version */
    public List<Map<String, Object>> summary() {
        List<String> keys = db.query(
                "SELECT DISTINCT KEY_ FROM act_re_procdef",
                (rs, i) -> rs.getString("KEY_"));

        List<Map<String, Object>> result = new ArrayList<>();
        for (String key : keys) {
            // Backfill all versions to version_history
            for (ProcessDefinition pd : repo.createProcessDefinitionQuery()
                    .processDefinitionKey(key).list()) {
                Integer exists = db.queryForObject(
                        "SELECT COUNT(*) FROM version_history WHERE process_key=? AND version=? AND deployment_id=?",
                        Integer.class, pd.getKey(), pd.getVersion(), pd.getDeploymentId());
                if (exists == null || exists == 0) {
                    db.update("INSERT INTO version_history (id, process_key, version, deployment_id, change_log) VALUES (?,?,?,?,?)",
                            UUID.randomUUID().toString().substring(0, 8),
                            pd.getKey(), pd.getVersion(), pd.getDeploymentId(), "Initial version (auto-deployed)");
                }
            }

            ProcessDefinition latest = repo.createProcessDefinitionQuery()
                    .processDefinitionKey(key).latestVersion().singleResult();

            List<Map<String, Object>> dist = db.query(
                    "SELECT pd.VERSION_ AS ver, COUNT(pi.PROC_INST_ID_) AS cnt " +
                    "FROM act_re_procdef pd " +
                    "LEFT JOIN act_hi_procinst pi ON pi.PROC_DEF_ID_ = pd.ID_ " +
                    "WHERE pd.KEY_ = ? GROUP BY pd.VERSION_ ORDER BY pd.VERSION_ DESC",
                    (rs, i) -> Map.<String,Object>of(
                            "version", rs.getInt("ver"),
                            "instanceCount", rs.getInt("cnt")
                    ), key);

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("processKey", key);
            m.put("processName", latest != null ? latest.getName() : key);
            m.put("latestVersion", latest != null ? latest.getVersion() : 0);
            m.put("totalVersions", dist.size());
            m.put("versionDistribution", dist);
            result.add(m);
        }
        return result;
    }
}
