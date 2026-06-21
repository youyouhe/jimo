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

    // ============== Sync write API (NestJS → BPM org mirror) ==============

    public boolean deptExists(String deptId) {
        return orgRepository.deptExists(deptId);
    }

    /** Create a BPM user; generates and returns the EMP id. */
    public String createUser(String name, String deptId, String email, String title) {
        String id = orgRepository.nextUserId();
        orgRepository.createUser(id, name, deptId, email, title);
        // Default approver role (R02 = ROLE_CONTRACT_MGR, has process:view / approve perms)
        // so synced users can participate in approvals. Role mapping is a future refinement.
        orgRepository.assignRole(id, "R02");
        return id;
    }

    public void updateUser(String id, String name, String deptId, String email, String title) {
        orgRepository.updateUser(id, name, deptId, email, title);
    }

    public void deleteUser(String id) {
        orgRepository.deleteUser(id);
    }

    public void createDept(String id, String name, String parentId, String leadId) {
        orgRepository.createDept(id, name, parentId, leadId);
    }

    public void updateDept(String id, String name, String parentId, String leadId) {
        orgRepository.updateDept(id, name, parentId, leadId);
    }

    public void deleteDept(String id) {
        orgRepository.deleteDept(id);
    }
}
