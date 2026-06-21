package com.example.bpm.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Organization repository using JdbcTemplate for users and departments queries.
 */
@Repository
public class OrgRepository {

    private final JdbcTemplate db;

    public OrgRepository(JdbcTemplate db) {
        this.db = db;
    }

    public String getUserDept(String userId) {
        List<String> list = db.query("SELECT dept_id FROM users WHERE id=?",
                (rs, i) -> rs.getString("dept_id"), userId);
        return list.isEmpty() ? null : list.get(0);
    }

    public String getDeptLead(String deptId) {
        List<String> list = db.query("SELECT lead_id FROM departments WHERE id=?",
                (rs, i) -> rs.getString("lead_id"), deptId);
        return (list.isEmpty() || list.get(0) == null) ? null : list.get(0);
    }

    public String getParentDept(String deptId) {
        List<String> list = db.query("SELECT parent_id FROM departments WHERE id=?",
                (rs, i) -> rs.getString("parent_id"), deptId);
        return (list.isEmpty() || list.get(0) == null) ? null : list.get(0);
    }

    public String getUserByTitle(String title) {
        List<String> list = db.query("SELECT id FROM users WHERE title=? LIMIT 1",
                (rs, i) -> rs.getString("id"), title);
        return list.isEmpty() ? null : list.get(0);
    }

    public boolean userExists(String userId) {
        Integer c = db.queryForObject("SELECT COUNT(*) FROM users WHERE id=?", Integer.class, userId);
        return c != null && c > 0;
    }

    /**
     * Get user display info: id, name, dept name, email, title.
     */
    public List<com.example.bpm.entity.User> allUsers() {
        return db.query(
                "SELECT u.id, u.name, d.name AS dept_name, u.email, u.title, u.dept_id " +
                "FROM users u JOIN departments d ON u.dept_id = d.id",
                (rs, i) -> {
                    com.example.bpm.entity.User u = new com.example.bpm.entity.User();
                    u.setId(rs.getString("id"));
                    u.setName(rs.getString("name"));
                    u.setDeptId(rs.getString("dept_id"));
                    u.setEmail(rs.getString("email"));
                    u.setTitle(rs.getString("title"));
                    return u;
                });
    }

    public com.example.bpm.entity.User getUser(String id) {
        List<com.example.bpm.entity.User> list = db.query(
                "SELECT u.id, u.name, d.name AS dept_name, u.email, u.title, u.dept_id " +
                "FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.id=?",
                (rs, i) -> {
                    com.example.bpm.entity.User u = new com.example.bpm.entity.User();
                    u.setId(rs.getString("id"));
                    u.setName(rs.getString("name"));
                    u.setDeptId(rs.getString("dept_id"));
                    u.setEmail(rs.getString("email"));
                    u.setTitle(rs.getString("title"));
                    return u;
                }, id);
        return list.isEmpty() ? null : list.get(0);
    }

    public List<com.example.bpm.entity.User> findUsersByName(String name) {
        return db.query(
                "SELECT u.id, u.name, d.name AS dept_name, u.email, u.title, u.dept_id " +
                "FROM users u JOIN departments d ON u.dept_id = d.id WHERE u.name=?",
                (rs, i) -> {
                    com.example.bpm.entity.User u = new com.example.bpm.entity.User();
                    u.setId(rs.getString("id"));
                    u.setName(rs.getString("name"));
                    u.setDeptId(rs.getString("dept_id"));
                    u.setEmail(rs.getString("email"));
                    u.setTitle(rs.getString("title"));
                    return u;
                }, name);
    }

    public List<com.example.bpm.entity.Department> allDepartments() {
        return db.query("SELECT id, name, parent_id, lead_id FROM departments",
                (rs, i) -> {
                    com.example.bpm.entity.Department d = new com.example.bpm.entity.Department();
                    d.setId(rs.getString("id"));
                    d.setName(rs.getString("name"));
                    d.setParentId(rs.getString("parent_id"));
                    d.setLeadId(rs.getString("lead_id"));
                    return d;
                });
    }

    public String getDeptName(String deptId) {
        if (deptId == null) return null;
        List<String> list = db.query("SELECT name FROM departments WHERE id=?",
                (rs, i) -> rs.getString("name"), deptId);
        return list.isEmpty() ? deptId : list.get(0);
    }

    // ============== Sync write API (NestJS → BPM org mirror) ==============

    /** Next EMP id: MAX(numeric suffix of existing EMP ids) + 1, zero-padded to 3. */
    public String nextUserId() {
        Integer max = db.queryForObject(
                "SELECT MAX(CAST(SUBSTRING(id, 4) AS UNSIGNED)) FROM users WHERE id LIKE 'EMP%'",
                Integer.class);
        int next = (max == null ? 0 : max) + 1;
        return String.format("EMP%03d", next);
    }

    public boolean deptExists(String deptId) {
        if (deptId == null) return false;
        Integer c = db.queryForObject("SELECT COUNT(*) FROM departments WHERE id=?", Integer.class, deptId);
        return c != null && c > 0;
    }

    public void createUser(String id, String name, String deptId, String email, String title) {
        db.update("INSERT INTO users (id, name, dept_id, email, title) VALUES (?,?,?,?,?)",
                id, name, deptId, email, title);
    }

    /** Assign a BPM role to a user (INSERT IGNORE → idempotent on re-sync). */
    public void assignRole(String userId, String roleId) {
        db.update("INSERT IGNORE INTO user_roles (id, user_id, role_id) VALUES (?,?,?)",
                "UR_" + userId, userId, roleId);
    }

    /** Full-field replace; caller (NestJS sync) sends the complete state. */
    public int updateUser(String id, String name, String deptId, String email, String title) {
        return db.update("UPDATE users SET name=?, dept_id=?, email=?, title=? WHERE id=?",
                name, deptId, email, title, id);
    }

    public int deleteUser(String id) {
        return db.update("DELETE FROM users WHERE id=?", id);
    }

    public void createDept(String id, String name, String parentId, String leadId) {
        // Upsert: NestJS sync always POSTs; a re-sync or retry must not fail on duplicate PK.
        db.update("INSERT INTO departments (id, name, parent_id, lead_id) VALUES (?,?,?,?) " +
                        "ON DUPLICATE KEY UPDATE name=VALUES(name), parent_id=VALUES(parent_id), lead_id=VALUES(lead_id)",
                id, name, parentId, leadId);
    }

    public int updateDept(String id, String name, String parentId, String leadId) {
        return db.update("UPDATE departments SET name=?, parent_id=?, lead_id=? WHERE id=?",
                name, parentId, leadId, id);
    }

    public int deleteDept(String id) {
        return db.update("DELETE FROM departments WHERE id=?", id);
    }
}
