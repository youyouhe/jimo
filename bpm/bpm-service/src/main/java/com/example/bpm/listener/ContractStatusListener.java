package com.example.bpm.listener;

import com.example.bpm.service.ContractService;
import com.example.bpm.webhook.ApprovalOutcomeEvent;
import org.flowable.engine.delegate.TaskListener;
import org.flowable.task.service.delegate.DelegateTask;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * Updates contract status based on task name when the task is created.
 * "approvedNotice" -> APPROVED, "rejectedNotice" -> REJECTED
 *
 * <p>Also publishes an {@link ApprovalOutcomeEvent} so the NestJS low-code
 * platform can be notified (via webhook) after the BPM DB transaction commits.</p>
 */
@Component("contractStatusListener")
public class ContractStatusListener implements TaskListener {

    private final ContractService contractService;
    private final ApplicationEventPublisher eventPublisher;

    public ContractStatusListener(ContractService contractService,
                                  ApplicationEventPublisher eventPublisher) {
        this.contractService = contractService;
        this.eventPublisher = eventPublisher;
    }

    @Override
    public void notify(DelegateTask task) {
        String taskDefinitionKey = task.getTaskDefinitionKey();
        String contractId = (String) task.getVariable("contractId");

        if (contractId == null) return;

        String newStatus = switch (taskDefinitionKey) {
            case "approvedNotice" -> "APPROVED";
            case "rejectedNotice" -> "REJECTED";
            default -> null;
        };

        if (newStatus != null) {
            contractService.updateStatus(contractId, newStatus);

            // Notify the NestJS low-code platform (fires AFTER_COMMIT).
            String initiator = (String) task.getVariable("initiator");
            String approver = (String) task.getVariable("lastApprover");
            String comment = (String) task.getVariable("lastApprovalComment");
            eventPublisher.publishEvent(new ApprovalOutcomeEvent(
                    "contract",
                    contractId,
                    task.getProcessInstanceId(),
                    newStatus,
                    initiator,
                    approver,
                    comment,
                    System.currentTimeMillis()
            ));
        }
    }
}
