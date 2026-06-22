package com.example.bpm.service;

import com.example.bpm.entity.ApprovalRequest;
import com.example.bpm.repository.ApprovalRequestRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flowable.engine.HistoryService;
import org.flowable.engine.IdentityService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.engine.task.Comment;
import org.flowable.task.api.Task;
import org.flowable.task.api.history.HistoricTaskInstance;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
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
    private final HistoryService historyService;
    private final IdentityService identityService;
    private final ObjectMapper json = new ObjectMapper();

    public ApprovalService(ApprovalRequestRepository repo, RuntimeService runtimeService,
                           TaskService taskService, HistoryService historyService,
                           IdentityService identityService) {
        this.repo = repo;
        this.runtimeService = runtimeService;
        this.taskService = taskService;
        this.historyService = historyService;
        this.identityService = identityService;
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

        // Tell Flowable WHO is acting, so it records an identity link (participant)
        // in ACT_HI_IDENTITYLINK. Without this the historic task's assignee is lost.
        identityService.setAuthenticatedUserId(userId);
        // Explicit task-level link — completes the one auto-created at process level.
        taskService.addUserIdentityLink(t.getId(), userId, "participant");
        try {
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
        } finally {
            identityService.setAuthenticatedUserId(null);
        }

        return Map.of("completed", true, "approved", approved, "taskId", t.getId());
    }

    public List<Task> myTasks(String userId) {
        return taskService.createTaskQuery()
                .taskAssignee(userId)
                .orderByTaskCreateTime().desc()
                .list();
    }

    /**
     * Tasks the caller has already completed (the 已办 / "done by me" view).
     * Returns Maps shaped like {@link #myTasks} plus the action + comment parsed
     * from the comment the approver left at completion time. businessType /
     * businessKey are NOT fetched here — NestJS enriches them by joining
     * lc_business_approvals on processInstanceId (avoids a per-task variable N+1).
     */
    public List<Map<String, Object>> myDoneTasks(String userId) {
        // Use taskInvolvedUser (identity links) instead of taskAssignee because
        // Flowable clears the assignee field on historic tasks upon completion.
        List<HistoricTaskInstance> tasks = historyService.createHistoricTaskInstanceQuery()
                .taskInvolvedUser(userId)
                .finished()
                .orderByHistoricTaskInstanceEndTime().desc()
                .listPage(0, 100);
        List<Map<String, Object>> out = new ArrayList<>();
        for (HistoricTaskInstance t : tasks) {
            Map<String, Object> m = new HashMap<>();
            m.put("taskId", t.getId());
            m.put("taskName", t.getName());
            m.put("taskDefinitionKey", t.getTaskDefinitionKey());
            m.put("processInstanceId", t.getProcessInstanceId());
            m.put("endTime", t.getEndTime() == null ? null : t.getEndTime().getTime());

            // The approve() step stamps "[Approved] ..." / "[Rejected] ..." as a
            // task comment; parse the action + remainder from the last comment.
            String action = null;
            String comment = null;
            List<Comment> comments = taskService.getTaskComments(t.getId());
            if (comments != null && !comments.isEmpty()) {
                String full = comments.get(comments.size() - 1).getFullMessage();
                if (full != null) {
                    if (full.startsWith("[Approved]")) {
                        action = "APPROVED";
                        comment = full.substring("[Approved]".length()).trim();
                    } else if (full.startsWith("[Rejected]")) {
                        action = "REJECTED";
                        comment = full.substring("[Rejected]".length()).trim();
                    } else {
                        comment = full;
                    }
                }
            }
            m.put("action", action);
            m.put("comment", comment);
            out.add(m);
        }
        return out;
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
