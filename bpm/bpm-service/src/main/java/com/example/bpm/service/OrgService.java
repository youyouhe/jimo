package com.example.bpm.service;

import com.example.bpm.entity.Department;
import com.example.bpm.entity.User;
import com.example.bpm.repository.OrgRepository;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Organization service for user and department queries.
 */
@Service
public class OrgService {

    private final OrgRepository orgRepository;

    public OrgService(OrgRepository orgRepository) {
        this.orgRepository = orgRepository;
    }

    public List<User> allUsers() {
        return orgRepository.allUsers();
    }

    public User getUser(String id) {
        return orgRepository.getUser(id);
    }

    /**
     * Get display string for a user: "Name * DeptName (userId)"
     */
    public String display(String id) {
        if (id == null) return "(unknown)";
        User u = orgRepository.getUser(id);
        if (u == null) return id;
        String deptName = orgRepository.getDeptName(u.getDeptId());
        return u.getName() + " · " + (deptName != null ? deptName : "?") + " (" + u.getId() + ")";
    }

    public List<User> findByName(String name) {
        return orgRepository.findUsersByName(name);
    }

    public List<Department> allDepartments() {
        return orgRepository.allDepartments();
    }

    public String displayDept(String deptId) {
        if (deptId == null) return "(unknown dept)";
        String name = orgRepository.getDeptName(deptId);
        return name != null ? name : deptId;
    }

    public String getUserDept(String userId) {
        return orgRepository.getUserDept(userId);
    }
}
