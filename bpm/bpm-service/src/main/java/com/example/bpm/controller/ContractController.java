package com.example.bpm.controller;

import com.example.bpm.auth.AuthInterceptor;
import com.example.bpm.auth.Result;
import com.example.bpm.entity.Contract;
import com.example.bpm.service.AssigneeResolver;
import com.example.bpm.service.ContractService;
import com.example.bpm.service.OrgService;
import org.flowable.engine.HistoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.flowable.task.api.history.HistoricTaskInstance;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Contract management REST controller.
 * Migrated from flowable-demo ContractController with all 19 API endpoints.
 * Base path: /api/contracts (under /bpm context-path).
 */
@RestController
@RequestMapping("/api/contracts")
public class ContractController {

    private final ContractService contractService;
    private final AssigneeResolver assigneeResolver;
    private final RuntimeService runtimeService;
    private final TaskService taskService;
    private final HistoryService historyService;
    private final OrgService org;

    public ContractController(ContractService contractService,
                              AssigneeResolver assigneeResolver,
                              RuntimeService runtimeService,
                              TaskService taskService,
                              HistoryService historyService,
                              OrgService org) {
        this.contractService = contractService;
        this.assigneeResolver = assigneeResolver;
        this.runtimeService = runtimeService;
        this.taskService = taskService;
        this.historyService = historyService;
        this.org = org;
    }

    // ==================== CRUD Endpoints ====================

    /** 1. List contracts with filtering and data isolation */
    @GetMapping
    public Result<?> list(@RequestParam(required = false) String status,
                          @RequestParam(required = false) String categoryId,
                          @RequestParam(required = false) String initiatorId,
                          @RequestParam(defaultValue = "0") int page,
                          @RequestParam(defaultValue = "20") int size,
                          HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:list");
        // Data isolation: users without contract:list_all can only see their own contracts
        String currentUserId = (String) request.getAttribute("currentUserId");
        @SuppressWarnings("unchecked")
        Set<String> perms = (Set<String>) request.getAttribute("userPermissions");
        if (!perms.contains("contract:list_all")) {
            initiatorId = currentUserId; // Force override to current user
        }
        List<Contract> list = contractService.list(status, categoryId, initiatorId, page, size);
        int total = contractService.count(status, categoryId, initiatorId);

        List<Map<String, Object>> items = new ArrayList<>();
        for (Contract c : list) {
            Map<String, Object> m = toMap(c);
            m.put("categoryDisplay", getCategoryName(c.getCategoryId()));
            m.put("initiatorDisplay", org.display(c.getInitiatorId()));
            items.add(m);
        }

        return Result.ok(Map.of("list", items, "total", total, "page", page, "size", size));
    }

    /** 2. Create contract */
    @PostMapping
    public Result<?> create(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:create");
        String initiatorId = (String) request.getAttribute("currentUserId");
        if (initiatorId == null) return Result.fail(401, "Not authenticated");

        String title = (String) body.get("title");
        String categoryId = (String) body.get("categoryId");
        if (title == null || title.isBlank()) return Result.fail(400, "Contract title is required");
        if (categoryId == null || categoryId.isBlank()) return Result.fail(400, "Contract category is required");

        BigDecimal amount = body.get("amount") != null
                ? new BigDecimal(body.get("amount").toString()) : null;
        String counterparty = (String) body.get("counterparty");
        String description = (String) body.get("description");
        @SuppressWarnings("unchecked")
        Map<String, Object> formData = body.get("formData") instanceof Map
                ? (Map<String, Object>) body.get("formData") : null;

        Contract c = contractService.create(initiatorId, title, categoryId, amount, counterparty, description, formData);
        return Result.ok(toMap(c));
    }

    /** 3. Get contract by ID */
    @GetMapping("/{id}")
    public Result<?> get(@PathVariable String id, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        Contract c = contractService.getById(id);
        if (c == null) return Result.fail(404, "Contract not found");

        Map<String, Object> m = toMap(c);
        m.put("categoryDisplay", getCategoryName(c.getCategoryId()));
        m.put("initiatorDisplay", org.display(c.getInitiatorId()));
        m.put("approvalChain", c.getProcessInstanceId() != null
                ? contractService.resolveApprovalChain(c.getCategoryId(), c.getAmount() != null ? c.getAmount() : BigDecimal.ZERO)
                : Collections.emptyList());
        return Result.ok(m);
    }

    /** 4. Update contract */
    @PutMapping("/{id}")
    public Result<?> update(@PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:edit");
        checkOwnership(id, request, "contract:edit_all");
        contractService.update(id, body);
        return Result.ok(contractService.getById(id));
    }

    /** 5. Delete contract */
    @DeleteMapping("/{id}")
    public Result<?> delete(@PathVariable String id, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:delete");
        checkOwnership(id, request, "contract:edit_all");
        contractService.delete(id);
        return Result.ok();
    }

    // ==================== Approval Endpoints ====================

    /** 6. Submit contract for approval */
    @PostMapping("/{id}/submit")
    public Result<?> submit(@PathVariable String id, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:submit");
        checkOwnership(id, request, "contract:edit_all");
        Map<String, Object> result = new HashMap<>(contractService.startApproval(id));
        @SuppressWarnings("unchecked")
        List<String> chain = (List<String>) result.get("approvalChain");
        result.put("approvalPreview", resolveChainPreview(chain, contractService.getById(id).getInitiatorId()));
        return Result.ok(result);
    }

    /** 7. Get my pending task for a contract */
    @GetMapping("/{id}/my-task")
    public Result<?> myTask(@PathVariable String id, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        String userId = (String) request.getAttribute("currentUserId");
        if (userId == null) return Result.fail(401, "Not authenticated");

        Contract c = contractService.getById(id);
        if (c == null || c.getProcessInstanceId() == null) return Result.ok(null);

        List<Task> tasks = taskService.createTaskQuery()
                .processInstanceId(c.getProcessInstanceId())
                .taskAssignee(userId)
                .list();

        if (tasks.isEmpty()) return Result.ok(null);

        Task t = tasks.get(0);
        Map<String, Object> vars = runtimeService.getVariables(t.getProcessInstanceId());
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("taskId", t.getId());
        result.put("taskName", t.getName());
        result.put("taskDefinitionKey", t.getTaskDefinitionKey());
        result.put("assignee", t.getAssignee());
        result.put("assigneeDisplay", org.display(t.getAssignee()));
        result.put("contractTitle", vars.get("contractTitle"));
        result.put("currentRule", vars.get("currentStepLabel"));

        Object hasMoreObj = vars.get("hasMoreSteps");
        result.put("isLastStep", !Boolean.TRUE.equals(hasMoreObj));

        return Result.ok(result);
    }

    /** 8. Approve or reject a contract task */
    @PostMapping("/{id}/approve")
    public Result<?> approve(@PathVariable String id,
                             @RequestBody Map<String, Object> body,
                             HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:approve");
        String userId = (String) request.getAttribute("currentUserId");
        if (userId == null) return Result.fail(401, "Not authenticated");

        Contract c = contractService.getById(id);
        if (c == null || c.getProcessInstanceId() == null) return Result.fail(400, "Contract is not in approval process");

        List<Task> tasks = taskService.createTaskQuery()
                .processInstanceId(c.getProcessInstanceId())
                .taskAssignee(userId)
                .list();

        if (tasks.isEmpty()) return Result.fail(400, "No pending task found");

        Task t = tasks.get(0);
        boolean approved = Boolean.TRUE.equals(body.get("approved"));
        String comment = (String) body.getOrDefault("comment", "");

        String action = approved ? "[Approved]" : "[Rejected]";
        String record = action + " " + org.display(userId) + (comment.isBlank() ? "" : ": " + comment);
        taskService.addComment(t.getId(), t.getProcessInstanceId(), record);

        runtimeService.setVariable(t.getProcessInstanceId(), "assignee_" + t.getId(), userId);

        Map<String, Object> vars = new HashMap<>();
        if ("approvalStep".equals(t.getTaskDefinitionKey()) || "managerReview".equals(t.getTaskDefinitionKey())) {
            vars.put("approved", approved);
        }

        taskService.complete(t.getId(), vars);

        return Result.ok(Map.of(
                "completed", true,
                "approved", approved,
                "taskId", t.getId(),
                "taskName", t.getName()
        ));
    }

    /** 9. Get all my pending tasks */
    @GetMapping("/my-tasks")
    public Result<?> myTasks(HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        String userId = (String) request.getAttribute("currentUserId");
        if (userId == null) return Result.fail(401, "Not authenticated");

        List<Task> tasks = taskService.createTaskQuery()
                .taskAssignee(userId)
                .orderByTaskCreateTime().asc().list();

        List<Map<String, Object>> result = new ArrayList<>();
        for (Task t : tasks) {
            Map<String, Object> vars = runtimeService.getVariables(t.getProcessInstanceId());
            String contractId = (String) vars.get("contractId");
            if (contractId == null) continue;

            Contract c = contractService.getById(contractId);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("taskId", t.getId());
            m.put("taskName", t.getName());
            m.put("taskDefinitionKey", t.getTaskDefinitionKey());
            m.put("contractId", contractId);
            m.put("contractTitle", vars.get("contractTitle"));
            m.put("contractNo", c != null ? c.getContractNo() : "");
            m.put("createTime", t.getCreateTime());
            result.add(m);
        }
        return Result.ok(result);
    }

    /** 10. Get approval preview for a contract */
    @GetMapping("/{id}/approval-preview")
    public Result<?> approvalPreview(@PathVariable String id, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        Contract c = contractService.getById(id);
        if (c == null) return Result.fail(404, "Contract not found");

        List<String> chain = contractService.resolveApprovalChain(
                c.getCategoryId(), c.getAmount() != null ? c.getAmount() : BigDecimal.ZERO);
        List<Map<String, Object>> preview = resolveChainPreview(chain, c.getInitiatorId());
        return Result.ok(preview);
    }

    /** 11. Get approval history for a contract */
    @GetMapping("/{id}/history")
    public Result<?> history(@PathVariable String id, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        Contract c = contractService.getById(id);
        if (c == null || c.getProcessInstanceId() == null) return Result.ok(Collections.emptyList());

        List<HistoricTaskInstance> tasks = historyService
                .createHistoricTaskInstanceQuery()
                .processInstanceId(c.getProcessInstanceId())
                .orderByHistoricTaskInstanceStartTime().asc().list();

        Map<String, Object> processVars = historyService
                .createHistoricVariableInstanceQuery()
                .processInstanceId(c.getProcessInstanceId())
                .list()
                .stream()
                .collect(Collectors.toMap(
                        v -> v.getVariableName(),
                        v -> v.getValue(),
                        (a, b) -> b));

        List<Map<String, Object>> result = new ArrayList<>();
        for (HistoricTaskInstance t : tasks) {
            String assignee = t.getAssignee();

            // Fallback: check process variable saved by approve endpoint (keyed by task ID)
            if (assignee == null) {
                Object varVal = processVars.get("assignee_" + t.getId());
                if (varVal instanceof String) {
                    assignee = (String) varVal;
                }
            }

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("taskId", t.getId());
            m.put("taskName", t.getName());
            m.put("taskDefinitionKey", t.getTaskDefinitionKey());
            m.put("assignee", assignee);
            m.put("assigneeDisplay", org.display(assignee));
            m.put("startTime", t.getStartTime());
            m.put("endTime", t.getEndTime());
            m.put("status", t.getEndTime() != null ? "completed" : "pending");

            var comments = taskService.getTaskComments(t.getId());
            m.put("comments", comments.stream().map(cm -> (Object) cm.getFullMessage()).toList());
            result.add(m);
        }
        return Result.ok(result);
    }

    // ==================== Category & Form Endpoints ====================

    /** 12. List contract categories */
    @GetMapping("/categories")
    public Result<?> categories(HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        return Result.ok(contractService.listCategories());
    }

    /** 13. Get form schema for a category */
    @GetMapping("/form-schema")
    public Result<?> formSchema(@RequestParam String categoryId, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        return Result.ok(contractService.getFormSchema(categoryId));
    }

    // ==================== Contract Lines ====================

    /** 14. List contract lines */
    @GetMapping("/{id}/lines")
    public Result<?> listLines(@PathVariable String id, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        return Result.ok(contractService.listLines(id));
    }

    /** 15. Save contract lines */
    @PostMapping("/{id}/lines")
    public Result<?> saveLines(@PathVariable String id, @RequestBody List<Map<String, Object>> lines,
                               HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:edit");
        checkOwnership(id, request, "contract:edit_all");
        List<Map<String, Object>> saved = contractService.saveLines(id, lines);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("lines", saved);
        result.put("contract", toMap(contractService.getById(id)));
        return Result.ok(result);
    }

    // ==================== Fulfillment Endpoints ====================

    /** 16. List fulfillments */
    @GetMapping("/{id}/fulfillments")
    public Result<?> listFulfillments(@PathVariable String id, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:view");
        return Result.ok(contractService.listFulfillments(id));
    }

    /** 17. Add fulfillment */
    @PostMapping("/{id}/fulfillments")
    public Result<?> addFulfillment(@PathVariable String id, @RequestBody Map<String, Object> body,
                                    HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:edit");
        checkOwnership(id, request, "contract:edit_all");
        String userId = (String) request.getAttribute("currentUserId");
        return Result.ok(contractService.addFulfillment(id, userId, body));
    }

    /** 18. Update fulfillment */
    @PutMapping("/{contractId}/fulfillments/{fid}")
    public Result<?> updateFulfillment(@PathVariable String contractId, @PathVariable String fid,
                                       @RequestBody Map<String, Object> body, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:edit");
        checkOwnership(contractId, request, "contract:edit_all");
        return Result.ok(contractService.updateFulfillment(fid, body));
    }

    /** 19. Delete fulfillment */
    @DeleteMapping("/{contractId}/fulfillments/{fid}")
    public Result<?> deleteFulfillment(@PathVariable String contractId, @PathVariable String fid,
                                       HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "contract:edit");
        checkOwnership(contractId, request, "contract:edit_all");
        contractService.deleteFulfillment(fid);
        return Result.ok();
    }

    // ==================== Helper Methods ====================

    /** Row-level data isolation: users without allPermission can only operate on their own contracts */
    @SuppressWarnings("unchecked")
    private void checkOwnership(String contractId, HttpServletRequest request, String allPermission) {
        Set<String> perms = (Set<String>) request.getAttribute("userPermissions");
        if (perms != null && perms.contains(allPermission)) return; // Admin bypass
        String currentUserId = (String) request.getAttribute("currentUserId");
        Contract c = contractService.getById(contractId);
        if (c == null) throw new IllegalArgumentException("Contract not found");
        if (!currentUserId.equals(c.getInitiatorId())) {
            throw new SecurityException("Can only operate on your own contracts");
        }
    }

    private Map<String, Object> toMap(Contract c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.getId());
        m.put("contractNo", c.getContractNo());
        m.put("title", c.getTitle());
        m.put("categoryId", c.getCategoryId());
        m.put("amount", c.getAmount());
        m.put("currency", c.getCurrency());
        m.put("counterparty", c.getCounterparty());
        m.put("ourParty", c.getOurParty());
        m.put("description", c.getDescription());
        m.put("status", c.getStatus());
        m.put("initiatorId", c.getInitiatorId());
        m.put("deptId", c.getDeptId());
        m.put("processInstanceId", c.getProcessInstanceId());
        m.put("formKey", c.getFormKey());
        m.put("formData", c.getFormData());
        m.put("createdAt", c.getCreatedAt());
        m.put("updatedAt", c.getUpdatedAt());
        return m;
    }

    private List<Map<String, Object>> resolveChainPreview(List<String> chain, String initiatorId) {
        List<Map<String, Object>> preview = new ArrayList<>();
        for (String rule : chain) {
            String resolved = assigneeResolver.resolve(rule, initiatorId);
            Map<String, Object> step = new LinkedHashMap<>();
            step.put("rule", rule);
            step.put("ruleLabel", getRuleLabel(rule));
            step.put("userId", resolved);
            step.put("userDisplay", resolved != null ? org.display(resolved) : "Not found");
            preview.add(step);
        }
        return preview;
    }

    private String getRuleLabel(String rule) {
        var rules = assigneeResolver.listRules();
        for (Map<String, Object> r : rules) {
            if (rule.equals(r.get("ruleName"))) return (String) r.get("label");
        }
        return rule;
    }

    private String getCategoryName(String categoryId) {
        if (categoryId == null) return "";
        var cats = contractService.listCategories();
        for (Map<String, Object> cat : cats) {
            if (categoryId.equals(cat.get("id"))) return (String) cat.get("name");
        }
        return categoryId;
    }
}
