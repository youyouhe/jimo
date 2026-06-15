package com.example.bpm.listener;

import com.example.bpm.service.AssigneeResolver;
import org.flowable.engine.delegate.TaskListener;
import org.flowable.task.service.delegate.DelegateTask;
import org.springframework.stereotype.Component;

/**
 * Task listener that dynamically resolves assignee on task creation.
 * Reads process variable "assigneeRule" to determine resolution strategy,
 * then delegates to AssigneeResolver for the actual lookup.
 */
@Component("dynamicAssigneeListener")
public class DynamicAssigneeListener implements TaskListener {

    private final AssigneeResolver resolver;

    public DynamicAssigneeListener(AssigneeResolver resolver) {
        this.resolver = resolver;
    }

    @Override
    public void notify(DelegateTask task) {
        // Rule read from process variable: assigneeRule = "deptHead" | "deptFinance" | specific userId
        String rule = (String) task.getVariable("assigneeRule");
        if (rule == null) {
            rule = (String) task.getVariable("currentRule");
        }
        String initiator = (String) task.getVariable("initiator");

        if (rule == null) {
            // No rule -- do not touch assignee (BPMN may have already set a fixed value)
            return;
        }

        String resolved = resolver.resolve(rule, initiator);

        if (resolved != null) {
            task.setAssignee(resolved);

            // Write resolution result to variables for later inspection
            task.setVariable("resolvedAssignee", resolved);
            task.setVariable("resolvedBy", "rule:" + rule + " from:" + initiator);
        }
    }
}
