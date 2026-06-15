package com.example.bpm.controller;

import com.example.bpm.auth.AuthInterceptor;
import com.example.bpm.auth.Result;
import com.example.bpm.service.DeploymentService;
import org.springframework.web.bind.annotation.*;

import javax.servlet.http.HttpServletRequest;
import java.util.*;

/**
 * BPMN deployment and version management controller.
 * Provides deploy, version listing, summary, and process inspection endpoints.
 * Base path: /api/admin (process inspection under /api/process).
 */
@RestController
public class DeploymentController {

    private final DeploymentService deploymentService;

    public DeploymentController(DeploymentService deploymentService) {
        this.deploymentService = deploymentService;
    }

    // ====================== Deployment ======================

    /** Deploy a new BPMN process version */
    @PostMapping("/api/admin/deploy")
    public Result<?> deploy(@RequestParam String processKey,
                            @RequestParam(required = false) String changeLog,
                            @RequestBody String bpmnXml,
                            HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:deploy");
        String resourceName = processKey + ".bpmn20.xml";
        return Result.ok(deploymentService.deploy(processKey, resourceName, bpmnXml,
                changeLog != null ? changeLog : "Deployed via API"));
    }

    // ====================== Version History ======================

    /** List all versions for a process key */
    @GetMapping("/api/admin/versions/{processKey}")
    public Result<?> versions(@PathVariable String processKey, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:view");
        return Result.ok(deploymentService.versions(processKey));
    }

    /** Version summary across all process keys */
    @GetMapping("/api/admin/version-summary")
    public Result<?> versionSummary(HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:view");
        return Result.ok(deploymentService.summary());
    }

    // ====================== Process Instance Inspection ======================

    /** Get version info for a running process instance */
    @GetMapping("/api/process/{processInstanceId}/version")
    public Result<?> processVersion(@PathVariable String processInstanceId, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:view");
        return Result.ok(deploymentService.instanceVersion(processInstanceId));
    }

    /** Get viewer/diagram data for a process instance (returns process definition info) */
    @GetMapping("/api/process/{processInstanceId}/viewer")
    public Result<?> processViewer(@PathVariable String processInstanceId, HttpServletRequest request) {
        AuthInterceptor.requirePermission(request, "process:view");
        Map<String, Object> info = deploymentService.instanceVersion(processInstanceId);
        // Add BPMN XML content for viewer rendering
        @SuppressWarnings("unchecked")
        Map<String, Object> result = new LinkedHashMap<>(info);
        result.put("viewerUrl", "/bpm/api/process/" + processInstanceId + "/diagram");
        return Result.ok(result);
    }
}
