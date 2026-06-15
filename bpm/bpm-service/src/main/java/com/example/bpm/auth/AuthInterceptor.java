package com.example.bpm.auth;

import com.example.bpm.service.RbacService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.util.Set;

/**
 * Authentication interceptor for internal microservice.
 * Extracts user identity from x-user-id and x-authority-id headers
 * set by the Go backend proxy (gin-vue-admin).
 * Loads user permissions into request attributes for RBAC checks.
 *
 * x-user-id can be either:
 * - A GVA username (e.g. "admin") — mapped to BPM user
 * - A BPM user ID (e.g. "EMP008") — used directly
 * - A numeric ID — falls back to admin
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    private final RbacService rbacService;
    private final JdbcTemplate jdbc;
    private final ObjectMapper json = new ObjectMapper();

    public AuthInterceptor(RbacService rbacService, JdbcTemplate jdbc) {
        this.rbacService = rbacService;
        this.jdbc = jdbc;
    }

    /**
     * Resolve the x-user-id header value to a BPM user ID.
     */
    private String resolveBpmUserId(String rawId) {
        // If it already looks like a BPM user ID, use directly
        if (rawId.startsWith("EMP")) {
            return rawId;
        }
        // Try to find by name in BPM users table
        var rows = jdbc.query(
                "SELECT id FROM users WHERE name = ? OR id = ?",
                (rs, i) -> rs.getString("id"), rawId, rawId);
        if (!rows.isEmpty()) {
            return rows.get(0);
        }
        // Fallback: use admin
        return "EMP008";
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) return true;

        // Extract user identity from headers set by Go backend proxy
        String rawId = request.getHeader("x-user-id");
        if (rawId == null || rawId.isBlank()) {
            writeError(response, 401, "Not authenticated");
            return false;
        }

        String userId = resolveBpmUserId(rawId);

        // Load permissions for RBAC checks
        Set<String> permissions = rbacService.getUserPermissions(userId);

        request.setAttribute("currentUserId", userId);
        request.setAttribute("userPermissions", permissions);
        return true;
    }

    /**
     * Permission check utility method, called from Controllers.
     */
    public static void requirePermission(HttpServletRequest request, String permissionCode) {
        @SuppressWarnings("unchecked")
        Set<String> perms = (Set<String>) request.getAttribute("userPermissions");
        if (perms == null || !perms.contains(permissionCode)) {
            throw new SecurityException("Permission required: " + permissionCode);
        }
    }

    private void writeError(HttpServletResponse response, int code, String message) throws Exception {
        response.setStatus(code);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(json.writeValueAsString(Result.fail(code, message)));
    }
}
