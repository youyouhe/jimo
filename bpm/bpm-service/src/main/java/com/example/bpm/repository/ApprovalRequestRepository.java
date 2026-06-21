package com.example.bpm.repository;

import com.example.bpm.entity.ApprovalRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;

@Repository
public class ApprovalRequestRepository {

    private final JdbcTemplate db;

    public ApprovalRequestRepository(JdbcTemplate db) {
        this.db = db;
    }

    /**
     * Upsert: a business row that was REJECTED can be re-submitted (new process
     * instance); we update the existing row instead of violating the unique key.
     */
    public void upsert(ApprovalRequest r) {
        db.update("INSERT INTO approval_requests (id, business_type, business_key, process_key, status, initiator_id, process_instance_id) "
                        + "VALUES (?,?,?,?,?,?,?) "
                        + "ON DUPLICATE KEY UPDATE process_key=VALUES(process_key), status=VALUES(status), "
                        + "initiator_id=VALUES(initiator_id), process_instance_id=VALUES(process_instance_id), updated_at=CURRENT_TIMESTAMP",
                r.getId(), r.getBusinessType(), r.getBusinessKey(), r.getProcessKey(),
                r.getStatus(), r.getInitiatorId(), r.getProcessInstanceId());
    }

    public void updateStatus(String id, String status) {
        db.update("UPDATE approval_requests SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", status, id);
    }

    public ApprovalRequest findByProcessInstance(String processInstanceId) {
        List<ApprovalRequest> l = db.query(
                "SELECT * FROM approval_requests WHERE process_instance_id=?",
                ApprovalRequestRepository::map, processInstanceId);
        return l.isEmpty() ? null : l.get(0);
    }

    public ApprovalRequest findByBusiness(String businessType, String businessKey) {
        List<ApprovalRequest> l = db.query(
                "SELECT * FROM approval_requests WHERE business_type=? AND business_key=?",
                ApprovalRequestRepository::map, businessType, businessKey);
        return l.isEmpty() ? null : l.get(0);
    }

    private static ApprovalRequest map(ResultSet rs, int i) throws SQLException {
        ApprovalRequest r = new ApprovalRequest();
        r.setId(rs.getString("id"));
        r.setBusinessType(rs.getString("business_type"));
        r.setBusinessKey(rs.getString("business_key"));
        r.setProcessKey(rs.getString("process_key"));
        r.setStatus(rs.getString("status"));
        r.setInitiatorId(rs.getString("initiator_id"));
        r.setProcessInstanceId(rs.getString("process_instance_id"));
        Timestamp c = rs.getTimestamp("created_at");
        r.setCreatedAt(c == null ? null : c.toInstant());
        Timestamp u = rs.getTimestamp("updated_at");
        r.setUpdatedAt(u == null ? null : u.toInstant());
        return r;
    }
}
