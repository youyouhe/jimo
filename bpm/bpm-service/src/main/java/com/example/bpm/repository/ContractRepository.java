package com.example.bpm.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.example.bpm.entity.Contract;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/**
 * Contract repository using JdbcTemplate for CRUD operations.
 */
@Repository
public class ContractRepository {

    private final JdbcTemplate db;
    private final ObjectMapper json = new ObjectMapper();

    public ContractRepository(JdbcTemplate db) {
        this.db = db;
    }

    public int insert(Contract c) {
        String formDataJson = c.getFormData() != null && !c.getFormData().isEmpty()
                ? toJson(c.getFormData()) : null;
        return db.update(
                "INSERT INTO contracts (id, contract_no, title, category_id, amount, counterparty, " +
                "description, status, initiator_id, dept_id, form_key, form_data, created_at, updated_at) " +
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                c.getId(), c.getContractNo(), c.getTitle(), c.getCategoryId(), c.getAmount(),
                c.getCounterparty(), c.getDescription(), c.getStatus(),
                c.getInitiatorId(), c.getDeptId(), c.getFormKey(), formDataJson,
                c.getCreatedAt(), c.getUpdatedAt());
    }

    public Contract findById(String id) {
        List<Contract> list = db.query("SELECT * FROM contracts WHERE id=?", (rs, rowNum) -> {
            Contract c = new Contract();
            c.setId(rs.getString("id"));
            c.setContractNo(rs.getString("contract_no"));
            c.setTitle(rs.getString("title"));
            c.setCategoryId(rs.getString("category_id"));
            c.setAmount(rs.getBigDecimal("amount"));
            c.setCurrency(rs.getString("currency"));
            c.setCounterparty(rs.getString("counterparty"));
            c.setOurParty(rs.getString("our_party"));
            c.setDescription(rs.getString("description"));
            c.setStatus(rs.getString("status"));
            c.setInitiatorId(rs.getString("initiator_id"));
            c.setDeptId(rs.getString("dept_id"));
            c.setProcessInstanceId(rs.getString("process_instance_id"));
            c.setFormKey(rs.getString("form_key"));
            c.setCreatedAt(rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null);
            c.setUpdatedAt(rs.getTimestamp("updated_at") != null ? rs.getTimestamp("updated_at").toInstant() : null);
            String fd = rs.getString("form_data");
            if (fd != null && !fd.isBlank()) {
                try {
                    c.setFormData(json.readValue(fd, Map.class));
                } catch (Exception ignored) {}
            }
            return c;
        }, id);
        return list.isEmpty() ? null : list.get(0);
    }

    public List<Contract> list(String status, String categoryId, String initiatorId, int page, int size) {
        StringBuilder sql = new StringBuilder("SELECT * FROM contracts WHERE 1=1");
        List<Object> params = new ArrayList<>();

        if (status != null && !status.isBlank()) {
            sql.append(" AND status=?");
            params.add(status);
        }
        if (categoryId != null && !categoryId.isBlank()) {
            sql.append(" AND category_id=?");
            params.add(categoryId);
        }
        if (initiatorId != null && !initiatorId.isBlank()) {
            sql.append(" AND initiator_id=?");
            params.add(initiatorId);
        }

        sql.append(" ORDER BY created_at DESC LIMIT ? OFFSET ?");
        params.add(size);
        params.add(page * size);

        return db.query(sql.toString(), (rs, rowNum) -> {
            Contract c = new Contract();
            c.setId(rs.getString("id"));
            c.setContractNo(rs.getString("contract_no"));
            c.setTitle(rs.getString("title"));
            c.setCategoryId(rs.getString("category_id"));
            c.setAmount(rs.getBigDecimal("amount"));
            c.setCounterparty(rs.getString("counterparty"));
            c.setStatus(rs.getString("status"));
            c.setInitiatorId(rs.getString("initiator_id"));
            c.setDeptId(rs.getString("dept_id"));
            c.setProcessInstanceId(rs.getString("process_instance_id"));
            c.setFormKey(rs.getString("form_key"));
            c.setCreatedAt(rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null);
            return c;
        }, params.toArray());
    }

    public int count(String status, String categoryId, String initiatorId) {
        StringBuilder sql = new StringBuilder("SELECT COUNT(*) FROM contracts WHERE 1=1");
        List<Object> params = new ArrayList<>();

        if (status != null && !status.isBlank()) {
            sql.append(" AND status=?");
            params.add(status);
        }
        if (categoryId != null && !categoryId.isBlank()) {
            sql.append(" AND category_id=?");
            params.add(categoryId);
        }
        if (initiatorId != null && !initiatorId.isBlank()) {
            sql.append(" AND initiator_id=?");
            params.add(initiatorId);
        }

        Integer count = db.queryForObject(sql.toString(), Integer.class, params.toArray());
        return count != null ? count : 0;
    }

    public int updateStatus(String id, String status) {
        return db.update("UPDATE contracts SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", status, id);
    }

    public int updateProcessInstanceId(String id, String processInstanceId) {
        return db.update("UPDATE contracts SET process_instance_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                processInstanceId, id);
    }

    public int updateFields(String id, Map<String, Object> updates) {
        StringBuilder sql = new StringBuilder("UPDATE contracts SET updated_at=CURRENT_TIMESTAMP");
        List<Object> params = new ArrayList<>();

        if (updates.containsKey("title")) {
            sql.append(", title=?");
            params.add(updates.get("title"));
        }
        if (updates.containsKey("amount")) {
            sql.append(", amount=?");
            params.add(updates.get("amount"));
        }
        if (updates.containsKey("counterparty")) {
            sql.append(", counterparty=?");
            params.add(updates.get("counterparty"));
        }
        if (updates.containsKey("description")) {
            sql.append(", description=?");
            params.add(updates.get("description"));
        }
        if (updates.containsKey("ourParty")) {
            sql.append(", our_party=?");
            params.add(updates.get("ourParty"));
        }
        if (updates.containsKey("formData")) {
            sql.append(", form_data=?");
            Object fd = updates.get("formData");
            params.add(fd instanceof Map && !((Map<?, ?>) fd).isEmpty() ? toJson(fd) : null);
        }

        sql.append(" WHERE id=?");
        params.add(id);
        return db.update(sql.toString(), params.toArray());
    }

    public int deleteById(String id) {
        return db.update("DELETE FROM contracts WHERE id=?", id);
    }

    public int updateAmount(String id, BigDecimal total) {
        return db.update("UPDATE contracts SET amount=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", total, id);
    }

    // ==================== Contract Lines ====================

    public List<Map<String, Object>> listLines(String contractId) {
        return db.query("SELECT * FROM contract_lines WHERE contract_id=? ORDER BY seq, id",
                (rs, rowNum) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("contractId", rs.getString("contract_id"));
                    m.put("seq", rs.getInt("seq"));
                    m.put("itemName", rs.getString("item_name"));
                    m.put("specification", rs.getString("specification"));
                    m.put("unit", rs.getString("unit"));
                    m.put("quantity", rs.getBigDecimal("quantity"));
                    m.put("unitPrice", rs.getBigDecimal("unit_price"));
                    m.put("amount", rs.getBigDecimal("amount"));
                    m.put("remark", rs.getString("remark"));
                    return m;
                }, contractId);
    }

    public void deleteLines(String contractId) {
        db.update("DELETE FROM contract_lines WHERE contract_id=?", contractId);
    }

    public void insertLine(String id, String contractId, int seq, String itemName,
                           String specification, String unit,
                           BigDecimal quantity, BigDecimal unitPrice,
                           BigDecimal amount, String remark) {
        db.update("INSERT INTO contract_lines (id, contract_id, seq, item_name, specification, " +
                        "unit, quantity, unit_price, amount, remark) VALUES (?,?,?,?,?,?,?,?,?,?)",
                id, contractId, seq, itemName, specification, unit, quantity, unitPrice, amount, remark);
    }

    public BigDecimal sumLineAmounts(String contractId) {
        List<BigDecimal> result = db.query("SELECT COALESCE(SUM(amount), 0) FROM contract_lines WHERE contract_id=?",
                (rs, rowNum) -> rs.getBigDecimal(1), contractId);
        return result.isEmpty() ? BigDecimal.ZERO : result.get(0);
    }

    // ==================== Contract Fulfillments ====================

    public List<Map<String, Object>> listFulfillments(String contractId) {
        return db.query("SELECT * FROM contract_fulfillments WHERE contract_id=? ORDER BY seq, created_at",
                (rs, rowNum) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("contractId", rs.getString("contract_id"));
                    m.put("seq", rs.getInt("seq"));
                    m.put("type", rs.getString("type"));
                    m.put("title", rs.getString("title"));
                    m.put("description", rs.getString("description"));
                    m.put("planDate", rs.getDate("plan_date"));
                    m.put("actualDate", rs.getDate("actual_date"));
                    m.put("amount", rs.getBigDecimal("amount"));
                    m.put("status", rs.getString("status"));
                    m.put("createdBy", rs.getString("created_by"));
                    m.put("createdAt", rs.getTimestamp("created_at"));
                    return m;
                }, contractId);
    }

    public void insertFulfillment(String id, String contractId, int seq, String type,
                                   String title, String description,
                                   Object planDate, Object actualDate,
                                   BigDecimal amount, String status, String createdBy) {
        db.update("INSERT INTO contract_fulfillments (id, contract_id, seq, type, title, description, " +
                        "plan_date, actual_date, amount, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                id, contractId, seq, type, title, description,
                planDate, actualDate, amount, status, createdBy);
    }

    public int getMaxFulfillmentSeq(String contractId) {
        List<Integer> result = db.query("SELECT MAX(seq) FROM contract_fulfillments WHERE contract_id=?",
                (rs, rowNum) -> rs.getInt(1), contractId);
        return result.isEmpty() || result.get(0) == null ? 0 : result.get(0);
    }

    public void updateFulfillment(String fulfillmentId, Map<String, Object> body) {
        StringBuilder sql = new StringBuilder("UPDATE contract_fulfillments SET updated_at=CURRENT_TIMESTAMP");
        List<Object> params = new ArrayList<>();

        if (body.containsKey("type")) { sql.append(", type=?"); params.add(body.get("type")); }
        if (body.containsKey("title")) { sql.append(", title=?"); params.add(body.get("title")); }
        if (body.containsKey("description")) { sql.append(", description=?"); params.add(body.get("description")); }
        if (body.containsKey("planDate")) { sql.append(", plan_date=?"); params.add(body.get("planDate")); }
        if (body.containsKey("actualDate")) { sql.append(", actual_date=?"); params.add(body.get("actualDate")); }
        if (body.containsKey("amount")) { sql.append(", amount=?"); params.add(new BigDecimal(body.get("amount").toString())); }
        if (body.containsKey("status")) { sql.append(", status=?"); params.add(body.get("status")); }

        sql.append(" WHERE id=?");
        params.add(fulfillmentId);
        db.update(sql.toString(), params.toArray());
    }

    public void deleteFulfillment(String fulfillmentId) {
        db.update("DELETE FROM contract_fulfillments WHERE id=?", fulfillmentId);
    }

    // ==================== Contract Categories ====================

    public List<Map<String, Object>> listCategories() {
        return db.query("SELECT id, name, code, form_key FROM contract_categories WHERE enabled=TRUE ORDER BY sort_order",
                (rs, rowNum) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("id", rs.getString("id"));
                    m.put("name", rs.getString("name"));
                    m.put("code", rs.getString("code"));
                    String formKey = rs.getString("form_key");
                    m.put("formKey", formKey != null ? formKey : "");
                    return m;
                });
    }

    public List<Map<String, Object>> findCategoryById(String categoryId) {
        return db.query("SELECT amount_rules, approval_chain FROM contract_categories WHERE id=? AND enabled=TRUE",
                (rs, rowNum) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("amountRules", rs.getString("amount_rules"));
                    m.put("defaultChain", rs.getString("approval_chain"));
                    return m;
                }, categoryId);
    }

    public String getCategoryFormKey(String categoryId) {
        List<String> list = db.query("SELECT form_key FROM contract_categories WHERE id=?",
                (rs, rowNum) -> rs.getString("form_key"), categoryId);
        return (list.isEmpty() || list.get(0) == null) ? null : list.get(0);
    }

    public String generateContractNo() {
        Integer count = db.queryForObject("SELECT COUNT(*) FROM contracts", Integer.class);
        int next = (count != null ? count : 0) + 1;
        while (true) {
            String no = String.format("HT-2026-%04d", next);
            Integer exists = db.queryForObject("SELECT COUNT(*) FROM contracts WHERE contract_no=?",
                    Integer.class, no);
            if (exists == null || exists == 0) return no;
            next++;
        }
    }

    private String toJson(Object obj) {
        try { return json.writeValueAsString(obj); } catch (Exception e) { return null; }
    }
}
