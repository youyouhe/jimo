package com.example.bpm.listener;

import com.example.bpm.repository.OrgRepository;
import com.example.bpm.service.AssigneeResolver;
import org.flowable.engine.delegate.TaskListener;
import org.flowable.task.service.delegate.DelegateTask;
import org.springframework.stereotype.Component;

/**
 * Candidate group mode listener.
 * Instead of setting a direct assignee, adds candidate groups to the task.
 * Any user belonging to the group can claim the task.
 * Group relationships can change dynamically -- the actual binding happens at claim time.
 */
@Component("candidateGroupListener")
public class CandidateGroupListener implements TaskListener {

    private final AssigneeResolver resolver;
    private final OrgRepository orgRepository;

    public CandidateGroupListener(AssigneeResolver resolver, OrgRepository orgRepository) {
        this.resolver = resolver;
        this.orgRepository = orgRepository;
    }

    @Override
    public void notify(DelegateTask task) {
        String rule = (String) task.getVariable("assigneeRule");
        String initiator = (String) task.getVariable("initiator");

        if (rule == null) return;

        // Candidate group ID encodes role + scope: deptHead_D001
        String deptId = orgRepository.getUserDept(initiator);
        String groupId = rule + "_" + deptId;

        task.addCandidateGroup(groupId);

        // Record resolution process
        String resolved = resolver.resolve(rule, initiator);
        task.setVariable("candidateGroup", groupId);
        task.setVariable("currentHolder", resolved);      // Current role holder (reference only)
        task.setVariable("resolvedBy", "group:" + groupId + " from:" + initiator);
    }
}
