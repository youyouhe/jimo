package com.example.bpm.listener;

import com.example.bpm.entity.ApprovalRequest;
import com.example.bpm.repository.ApprovalRequestRepository;
import com.example.bpm.webhook.ApprovalOutcomeEvent;
import org.flowable.engine.delegate.TaskListener;
import org.flowable.task.service.delegate.DelegateTask;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;

/**
 * Generic counterpart of {@code ContractStatusListener}. Fires on the
 * approvedNotice / rejectedNotice tasks of the {@code genericApproval} process,
 * updates the {@code approval_requests} row, and publishes an
 * {@link ApprovalOutcomeEvent} so the existing webhook publisher notifies
 * NestJS — the same callback path used for contracts, now carrying
 * businessType/businessKey for any low-code table.
 */
@Component("genericApprovalListener")
public class GenericApprovalListener implements TaskListener {

    private final ApprovalRequestRepository repo;
    private final ApplicationEventPublisher publisher;

    public GenericApprovalListener(ApprovalRequestRepository repo, ApplicationEventPublisher publisher) {
        this.repo = repo;
        this.publisher = publisher;
    }

    @Override
    public void notify(DelegateTask task) {
        String taskDefinitionKey = task.getTaskDefinitionKey();
        String businessType = (String) task.getVariable("businessType");
        String businessKey = (String) task.getVariable("businessKey");
        if (businessType == null || businessKey == null) return;

        String newStatus = switch (taskDefinitionKey) {
            case "approvedNotice" -> "APPROVED";
            case "rejectedNotice" -> "REJECTED";
            default -> null;
        };
        if (newStatus == null) return;

        ApprovalRequest req = repo.findByBusiness(businessType, businessKey);
        if (req != null) {
            repo.updateStatus(req.getId(), newStatus);
        }

        publisher.publishEvent(new ApprovalOutcomeEvent(
                businessType,
                businessKey,
                task.getProcessInstanceId(),
                newStatus,
                (String) task.getVariable("initiator"),
                (String) task.getVariable("lastApprover"),
                (String) task.getVariable("lastApprovalComment"),
                System.currentTimeMillis()
        ));
    }
}
