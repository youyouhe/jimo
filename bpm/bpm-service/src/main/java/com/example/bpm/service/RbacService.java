package com.example.bpm.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * RBAC service for role/permission queries and management.
 */
@Service
public class RbacService {

    private final JdbcTemplate db;

    public RbacService(JdbcTemplate db) {
        this.db = db;
    }

    // ==================== Permission Queries ====================

    /**
     * Get all permission codes for a user (union of all roles).
     */
    public Set<String> getUserPermissions(String userId) {
        return new HashSet<>(db.query(
                "SELECT DISTINCT p.code FROM user_roles ur " +
                "JOIN role_permissions rp ON ur.role_id = rp.role_id " +
                "JOIN permissions p ON rp.permission_id = p.id " +
                "WHERE ur.user_id = ?",
                (rs, i) -> rs.getString("code"), userId));
    }

    /**
     * Get all role codes for a user.
     */
    public Set<String> getUserRoles(String userId) {
        return new HashSet<>(db.query(
                "SELECT r.code FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?",
                (rs, i) -> rs.getString("code"), userId));
    }

    /**
     * Check if a user has a specific permission.
     */
    public boolean hasPermission(String userId, String permissionCode) {
        return getUserPermissions(userId).contains(permissionCode);
    }

    /**
     * Get visible menu items for a user based on permissions.
     */
    public List<Map<String, Object>> getMenuItemsForUser(String userId) {
        Set<String> perms = getUserPermissions(userId);
        List<Map<String, Object>> all = db.query(
                "SELECT * FROM menu_items ORDER BY group_name, sort_order",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("code", rs.getString("code"));
                    m.put("label", rs.getString("label"));
                    m.put("icon", rs.getString("icon"));
                    m.put("groupName", rs.getString("group_name"));
                    m.put("sortOrder", rs.getInt("sort_order"));
                    m.put("link", rs.getString("link"));
                    m.put("permissionCode", rs.getString("permission_code"));
                    m.put("isPlaceholder", rs.getBoolean("is_placeholder"));
                    return m;
                });
        return all.stream()
                .filter(m -> m.get("permissionCode") == null || perms.contains(m.get("permissionCode")))
                .collect(Collectors.toList());
    }

    // ==================== Role Management ====================

    public List<Map<String, Object>> listRoles() {
        return db.query(
                "SELECT r.*, (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count " +
                "FROM roles r ORDER BY r.id",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("code", rs.getString("code"));
                    m.put("name", rs.getString("name"));
                    m.put("description", rs.getString("description"));
                    m.put("isSystem", rs.getBoolean("is_system"));
                    m.put("userCount", rs.getInt("user_count"));
                    return m;
                });
    }

    public Map<String, Object> createRole(String code, String name, String description) {
        String id = "R" + System.currentTimeMillis() % 100000;
        Integer exists = db.queryForObject("SELECT COUNT(*) FROM roles WHERE code=?", Integer.class, code);
        if (exists == null || exists == 0) {
            db.update("INSERT INTO roles (id, code, name, description, is_system) VALUES (?, ?, ?, ?, FALSE)",
                    id, code, name, description);
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("code", code);
        m.put("name", name);
        return m;
    }

    public void deleteRole(String roleId) {
        Integer isSystem = db.query("SELECT is_system FROM roles WHERE id=?",
                (rs, i) -> rs.getInt("is_system"), roleId).stream().findFirst().orElse(null);
        if (isSystem == null) throw new IllegalArgumentException("Role not found");
        if (isSystem == 1) throw new IllegalArgumentException("System role cannot be deleted");
        db.update("DELETE FROM role_permissions WHERE role_id=?", roleId);
        db.update("DELETE FROM user_roles WHERE role_id=?", roleId);
        db.update("DELETE FROM roles WHERE id=?", roleId);
    }

    // ==================== Permission Management ====================

    public List<Map<String, Object>> listPermissions() {
        return db.query("SELECT * FROM permissions ORDER BY module, id",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("code", rs.getString("code"));
                    m.put("name", rs.getString("name"));
                    m.put("module", rs.getString("module"));
                    return m;
                });
    }

    public List<Map<String, Object>> listPermissionsByModule() {
        List<Map<String, Object>> all = listPermissions();
        Map<String, List<Map<String, Object>>> grouped = new LinkedHashMap<>();
        for (Map<String, Object> p : all) {
            grouped.computeIfAbsent((String) p.get("module"), k -> new ArrayList<>()).add(p);
        }
        return grouped.entrySet().stream().map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("module", e.getKey());
            m.put("permissions", e.getValue());
            return m;
        }).collect(Collectors.toList());
    }

    public List<Map<String, Object>> getRolePermissions(String roleId) {
        return db.query(
                "SELECT p.* FROM role_permissions rp JOIN permissions p ON rp.permission_id = p.id " +
                "WHERE rp.role_id = ? ORDER BY p.module, p.id",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("code", rs.getString("code"));
                    m.put("name", rs.getString("name"));
                    m.put("module", rs.getString("module"));
                    return m;
                }, roleId);
    }

    public void assignPermissions(String roleId, List<String> permissionIds) {
        db.update("DELETE FROM role_permissions WHERE role_id=?", roleId);
        for (String pid : permissionIds) {
            String id = "RP" + roleId + "_" + pid;
            db.update("INSERT INTO role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)",
                    id, roleId, pid);
        }
    }

    // ==================== User-Role Management ====================

    public List<Map<String, Object>> getUserRolesDetail(String userId) {
        return db.query(
                "SELECT r.* FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("code", rs.getString("code"));
                    m.put("name", rs.getString("name"));
                    m.put("description", rs.getString("description"));
                    m.put("isSystem", rs.getBoolean("is_system"));
                    return m;
                }, userId);
    }

    public void assignRoles(String userId, List<String> roleIds) {
        db.update("DELETE FROM user_roles WHERE user_id=?", userId);
        for (String rid : roleIds) {
            String id = "UR" + userId + "_" + rid;
            db.update("INSERT INTO user_roles (id, user_id, role_id) VALUES (?, ?, ?)",
                    id, userId, rid);
        }
    }

    public List<Map<String, Object>> getAllMenuItems() {
        return db.query("SELECT * FROM menu_items ORDER BY group_name, sort_order",
                (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("code", rs.getString("code"));
                    m.put("label", rs.getString("label"));
                    m.put("icon", rs.getString("icon"));
                    m.put("groupName", rs.getString("group_name"));
                    m.put("sortOrder", rs.getInt("sort_order"));
                    m.put("link", rs.getString("link"));
                    m.put("permissionCode", rs.getString("permission_code"));
                    m.put("isPlaceholder", rs.getBoolean("is_placeholder"));
                    return m;
                });
    }
}
