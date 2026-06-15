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
}
