package com.example.bpm.service;

import com.example.bpm.entity.Contract;
import com.example.bpm.repository.ContractRepository;
import com.example.bpm.repository.OrgRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.runtime.ProcessInstance;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.*;

/**
 * Contract service: full CRUD + status management + approval chain resolution.
 */
@Service
public class ContractService {

    private final ContractRepository contractRepository;
    private final OrgRepository orgRepository;
    private final RuntimeService runtimeService;

    private final ObjectMapper json = new ObjectMapper();

    public ContractService(ContractRepository contractRepository, OrgRepository orgRepository,
                           RuntimeService runtimeService) {
        this.contractRepository = contractRepository;
        this.orgRepository = orgRepository;
        this.runtimeService = runtimeService;
    }

    public Contract create(String initiatorId, String title, String categoryId,
                           BigDecimal amount, String counterparty, String description,
                           Map<String, Object> formData) {
        Contract c = new Contract();
        c.setId(UUID.randomUUID().toString().replace("-", "").substring(0, 16));
        c.setContractNo(contractRepository.generateContractNo());
        c.setTitle(title);
        c.setCategoryId(categoryId);
        c.setAmount(amount);
        c.setCounterparty(counterparty);
        c.setDescription(description);
        c.setFormData(formData);
        c.setStatus("DRAFT");
        c.setInitiatorId(initiatorId);
        c.setDeptId(getUserDept(initiatorId));
        c.setFormKey(contractRepository.getCategoryFormKey(categoryId));
        c.setCreatedAt(Instant.now());
        c.setUpdatedAt(Instant.now());

        contractRepository.insert(c);
        return c;
    }

    public Contract getById(String id) {
        return contractRepository.findById(id);
    }

    public void update(String id, Map<String, Object> updates) {
        Contract c = getById(id);
        if (c == null) throw new IllegalArgumentException("Contract not found: " + id);

        // Status transition: whitelist validation
        if (updates.containsKey("status")) {
            String newStatus = (String) updates.get("status");
            boolean valid = ("APPROVED".equals(c.getStatus()) && "SIGNING".equals(newStatus))
                         || ("SIGNING".equals(c.getStatus()) && "EXECUTING".equals(newStatus))
                         || ("EXECUTING".equals(c.getStatus()) && "COMPLETED".equals(newStatus))
                         || ("EXECUTING".equals(c.getStatus()) && "TERMINATED".equals(newStatus));
            if (!valid) {
                throw new IllegalArgumentException("Status transition not allowed from " + c.getStatus() + " to " + newStatus);
            }
            contractRepository.updateStatus(id, newStatus);
            return; // Status change is handled separately, do not modify other fields
        }

        // Non-status field modification: only DRAFT / REJECTED allowed
        if (!"DRAFT".equals(c.getStatus()) && !"REJECTED".equals(c.getStatus())) {
            throw new IllegalArgumentException("Current status does not allow modification: " + c.getStatus());
        }

        contractRepository.updateFields(id, updates);
    }

    public void delete(String id) {
        Contract c = getById(id);
        if (c == null) throw new IllegalArgumentException("Contract not found: " + id);
        if (!"DRAFT".equals(c.getStatus())) throw new IllegalArgumentException("Only DRAFT contracts can be deleted");
        contractRepository.deleteById(id);
    }

    public List<Contract> list(String status, String categoryId, String initiatorId, int page, int size) {
        return contractRepository.list(status, categoryId, initiatorId, page, size);
    }

    public int count(String status, String categoryId, String initiatorId) {
        return contractRepository.count(status, categoryId, initiatorId);
    }

    public Map<String, Object> startApproval(String contractId) {
        Contract c = getById(contractId);
        if (c == null) throw new IllegalArgumentException("Contract not found: " + contractId);
        if (!"DRAFT".equals(c.getStatus()) && !"REJECTED".equals(c.getStatus())) {
            throw new IllegalArgumentException("Current status does not allow approval submission: " + c.getStatus());
        }

        List<String> chain = resolveApprovalChain(c.getCategoryId(), c.getAmount() != null ? c.getAmount() : BigDecimal.ZERO);

        Map<String, Object> vars = new HashMap<>();
        vars.put("initiator", c.getInitiatorId());
        vars.put("contractId", c.getId());
        vars.put("contractTitle", c.getTitle());
        vars.put("formKey", c.getFormKey() != null ? c.getFormKey() : "purchase_contract");
        vars.put("approvalChain", toJsonArray(chain));
        vars.put("chainIndex", 0);

        ProcessInstance pi = runtimeService.startProcessInstanceByKey("contractApprovalUniversal", vars);

        contractRepository.updateStatus(c.getId(), "PENDING_APPROVAL");
        contractRepository.updateProcessInstanceId(c.getId(), pi.getId());

        return Map.of(
                "processInstanceId", pi.getId(),
                "approvalChain", chain,
                "status", "PENDING_APPROVAL"
        );
    }

    public void updateStatus(String contractId, String status) {
        contractRepository.updateStatus(contractId, status);
    }

    @SuppressWarnings("unchecked")
    public List<String> resolveApprovalChain(String categoryId, BigDecimal amount) {
        List<Map<String, Object>> rows = contractRepository.findCategoryById(categoryId);

        if (rows.isEmpty()) throw new IllegalArgumentException("Contract category not found or disabled: " + categoryId);

        String amountRulesJson = (String) rows.get(0).get("amountRules");
        String defaultChainJson = (String) rows.get(0).get("defaultChain");

        if (amountRulesJson != null && !amountRulesJson.isBlank()) {
            try {
                List<Map<String, Object>> rules = json.readValue(amountRulesJson, List.class);
                for (Map<String, Object> rule : rules) {
                    BigDecimal max = new BigDecimal(rule.get("max").toString());
                    if (amount.compareTo(max) <= 0) {
                        return (List<String>) rule.get("chain");
                    }
                }
            } catch (Exception ignored) {}
        }

        try {
            return json.readValue(defaultChainJson, List.class);
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse approval chain", e);
        }
    }

    public List<Map<String, Object>> listCategories() {
        return contractRepository.listCategories();
    }

    public Object getFormSchema(String categoryId) {
        String formKey = contractRepository.getCategoryFormKey(categoryId);
        if (formKey == null) return null;
        // FormSchemaService will be integrated separately; return the formKey for now
        return Map.of("formKey", formKey);
    }

    // ==================== Contract Lines ====================

    private void checkLineEditable(String contractId) {
        Contract c = getById(contractId);
        if (c == null) throw new IllegalArgumentException("Contract not found: " + contractId);
        if (!"DRAFT".equals(c.getStatus()) && !"REJECTED".equals(c.getStatus())) {
            throw new IllegalArgumentException("Current status does not allow editing lines: " + c.getStatus());
        }
    }

    public List<Map<String, Object>> listLines(String contractId) {
        return contractRepository.listLines(contractId);
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> saveLines(String contractId, List<Map<String, Object>> lines) {
        checkLineEditable(contractId);

        contractRepository.deleteLines(contractId);

        for (int i = 0; i < lines.size(); i++) {
            Map<String, Object> line = lines.get(i);
            String id = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
            String itemName = (String) line.getOrDefault("itemName", "");
            if (itemName.isBlank()) continue;

            BigDecimal qty = line.get("quantity") != null
                    ? new BigDecimal(line.get("quantity").toString()) : BigDecimal.ONE;
            BigDecimal price = line.get("unitPrice") != null
                    ? new BigDecimal(line.get("unitPrice").toString()) : BigDecimal.ZERO;
            BigDecimal amount = qty.multiply(price).setScale(2, RoundingMode.HALF_UP);

            contractRepository.insertLine(id, contractId, i, itemName,
                    (String) line.getOrDefault("specification", ""),
                    (String) line.getOrDefault("unit", ""),
                    qty, price, amount,
                    (String) line.getOrDefault("remark", ""));
        }

        recalcAmount(contractId);
        return listLines(contractId);
    }

    private void recalcAmount(String contractId) {
        BigDecimal total = contractRepository.sumLineAmounts(contractId);
        contractRepository.updateAmount(contractId, total);
    }

    // ==================== Fulfillments ====================

    public List<Map<String, Object>> listFulfillments(String contractId) {
        return contractRepository.listFulfillments(contractId);
    }

    public Map<String, Object> addFulfillment(String contractId, String userId, Map<String, Object> body) {
        String id = "CF" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
        int maxSeq = contractRepository.getMaxFulfillmentSeq(contractId);
        int seq = maxSeq + 1;

        BigDecimal amount = body.get("amount") != null
                ? new BigDecimal(body.get("amount").toString()) : null;

        contractRepository.insertFulfillment(id, contractId, seq,
                (String) body.get("type"),
                (String) body.get("title"),
                (String) body.get("description"),
                body.get("planDate"),
                body.get("actualDate"),
                amount,
                (String) body.getOrDefault("status", "PLANNED"),
                userId);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("contractId", contractId);
        m.put("seq", seq);
        return m;
    }

    public Map<String, Object> updateFulfillment(String fulfillmentId, Map<String, Object> body) {
        contractRepository.updateFulfillment(fulfillmentId, body);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", fulfillmentId);
        return m;
    }

    public void deleteFulfillment(String fulfillmentId) {
        contractRepository.deleteFulfillment(fulfillmentId);
    }

    // ==================== Internal Helpers ====================

    private String getUserDept(String userId) {
        String dept = orgRepository.getUserDept(userId);
        return dept != null ? dept : "D000";
    }

    private String toJsonArray(List<String> list) {
        try { return json.writeValueAsString(list); } catch (Exception e) { return "[]"; }
    }

    private String toJson(Object obj) {
        try { return json.writeValueAsString(obj); } catch (Exception e) { return null; }
    }
}
