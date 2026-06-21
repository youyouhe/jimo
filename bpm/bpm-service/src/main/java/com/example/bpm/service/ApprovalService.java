package com.example.bpm.service;

import com.example.bpm.entity.ApprovalRequest;
import com.example.bpm.repository.ApprovalRequestRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.task.api.Task;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Generic approval service — the non-contract counterpart of the contract
 * approval flow. NestJS passes businessType/businessKey + the approval chain
 * (rule names resolved on the NestJS side or by the codegen config); this
 * starts the {@code genericApproval} process and tracks it in
 * {@code approval_requests}.
 */
@Service
public class ApprovalService {

    public static final String DEFAULT_PROCESS_KEY = "genericApproval";

    private final ApprovalRequestRepository repo;
    private final RuntimeService runtimeService;
    private final TaskService taskService;
    private final ObjectMapper json = new ObjectMapper();

    public ApprovalService(ApprovalRequestRepository repo, RuntimeService runtimeService, TaskService taskService) {
        this.repo = repo;
        this.runtimeService = runtimeService;
        this.taskService = taskService;
    }

    public Map<String, Object> start(String businessType, String businessKey, String processKey,
                                     String initiator, List<String> chain) {
        if (isBlank(businessType) || isBlank(businessKey)) {
            throw new IllegalArgumentException("businessType and businessKey are required");
        }
        if (chain == null || chain.isEmpty()) {
            throw new IllegalArgumentException("approvalChain is required");
        }
        String pk = isBlank(processKey) ? DEFAULT_PROCESS_KEY : processKey;

        Map<String, Object> vars = new HashMap<>();
        vars.put("initiator", initiator);
        vars.put("businessType", businessType);
        vars.put("businessKey", businessKey);
        vars.put("approvalChain", toJsonArray(chain));
        vars.put("chainIndex", 0);

        ProcessInstance pi = runtimeService.startProcessInstanceByKey(pk, vars);

        ApprovalRequest r = new ApprovalRequest();
        r.setId(UUID.randomUUID().toString().replace("-", "").substring(0, 16));
        r.setBusinessType(businessType);
        r.setBusinessKey(businessKey);
        r.setProcessKey(pk);
        r.setStatus("PENDING");
        r.setInitiatorId(initiator);
        r.setProcessInstanceId(pi.getId());
        repo.upsert(r);

        return Map.of(
                "processInstanceId", pi.getId(),
                "status", "PENDING",
                "approvalChain", chain
        );
    }

    public Map<String, Object> approve(String processInstanceId, String userId, boolean approved, String comment) {
        List<Task> tasks = taskService.createTaskQuery()
                .processInstanceId(processInstanceId)
                .taskAssignee(userId)
                .list();
        if (tasks.isEmpty()) {
            throw new IllegalArgumentException("No pending task for user " + userId + " in process " + processInstanceId);
        }
        Task t = tasks.get(0);

        if (comment != null && !comment.isBlank()) {
            String rec = (approved ? "[Approved]" : "[Rejected]") + " " + comment;
            taskService.addComment(t.getId(), processInstanceId, rec);
        }
        runtimeService.setVariable(processInstanceId, "lastApprover", userId);
        runtimeService.setVariable(processInstanceId, "lastApprovalComment", comment == null ? "" : comment);

        Map<String, Object> vars = new HashMap<>();
        if ("approvalStep".equals(t.getTaskDefinitionKey())) {
            vars.put("approved", approved);
        }
        taskService.complete(t.getId(), vars);

        return Map.of("completed", true, "approved", approved, "taskId", t.getId());
    }

    public List<Task> myTasks(String userId) {
        return taskService.createTaskQuery()
                .taskAssignee(userId)
                .orderByTaskCreateTime().desc()
                .list();
    }

    public ApprovalRequest get(String businessType, String businessKey) {
        return repo.findByBusiness(businessType, businessKey);
    }

    private String toJsonArray(List<String> chain) {
        try {
            return json.writeValueAsString(chain);
        } catch (Exception e) {
            return "[]";
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
