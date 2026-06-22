package com.example.bpm.controller;

import com.example.bpm.auth.AuthInterceptor;
import com.example.bpm.auth.Result;
import com.example.bpm.service.ApprovalService;
import org.flowable.task.api.Task;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Generic approval API — serves any low-code business table. NestJS starts a
 * flow here (passing businessType/businessKey + approvalChain), polls my-tasks,
 * and approves/rejects. Outcomes are pushed back to NestJS via the existing
 * webhook (GenericApprovalListener → ApprovalOutcomeEvent).
 *
 * Auth: x-user-id resolved by AuthInterceptor. {@code process:start} to
 * start/approve, {@code process:view} to query.
 */
@RestController
@RequestMapping("/api/approvals")
public class ApprovalController {

    private final ApprovalService approvalService;

    public ApprovalController(ApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    /** Start an approval flow. Body: { businessType, businessKey, processKey?, initiator, approvalChain: [rule...] }. */
    @PostMapping("/start")
    public Result<?> start(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:start");
        @SuppressWarnings("unchecked")
        List<String> chain = (List<String>) body.get("approvalChain");
        return Result.ok(approvalService.start(
                str(body, "businessType"),
                str(body, "businessKey"),
                str(body, "processKey"),
                str(body, "initiator"),
                chain));
    }

    /** Active tasks assigned to the caller (across all business types). */
    @GetMapping("/my-tasks")
    public Result<?> myTasks(HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:view");
        String userId = (String) request.getAttribute("currentUserId");
        List<Map<String, Object>> items = new ArrayList<>();
        for (Task t : approvalService.myTasks(userId)) {
            Map<String, Object> m = new HashMap<>();
            m.put("taskId", t.getId());
            m.put("taskName", t.getName());
            m.put("taskDefinitionKey", t.getTaskDefinitionKey());
            m.put("processInstanceId", t.getProcessInstanceId());
            m.put("assignee", t.getAssignee());
            m.put("createTime", t.getCreateTime() == null ? null : t.getCreateTime().getTime());
            items.add(m);
        }
        return Result.ok(Map.of("list", items, "total", items.size()));
    }

    /** Tasks the caller has already completed (已办), with action + comment parsed. */
    @GetMapping("/my-done")
    public Result<?> myDone(HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:view");
        String userId = (String) request.getAttribute("currentUserId");
        List<Map<String, Object>> items = approvalService.myDoneTasks(userId);
        return Result.ok(Map.of("list", items, "total", items.size()));
    }

    /** Approve or reject the caller's active task in a process. Body: { approved, comment? }. */
    @PostMapping("/{processInstanceId}/approve")
    public Result<?> approve(@PathVariable String processInstanceId,
                             @RequestBody Map<String, Object> body,
                             HttpServletRequest request) {
        // Real authorization is the task-assignment check in the service
        // (only the assigned approver can complete the task); this gate just
        // requires view-level access so managers/admins reach the endpoint.
        AuthInterceptor.requirePermission(request, "process:view");
        String userId = (String) request.getAttribute("currentUserId");
        return Result.ok(approvalService.approve(
                processInstanceId,
                userId,
                Boolean.TRUE.equals(body.get("approved")),
                str(body, "comment")));
    }

    /** Approval status for a business record. */
    @GetMapping("/{businessType}/{businessKey}")
    public Result<?> status(@PathVariable String businessType,
                            @PathVariable String businessKey,
                            HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:view");
        return Result.ok(approvalService.get(businessType, businessKey));
    }

    private static String str(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v == null ? null : v.toString();
    }
}
