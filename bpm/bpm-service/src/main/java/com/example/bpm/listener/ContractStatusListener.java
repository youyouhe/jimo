package com.example.bpm.listener;

import com.example.bpm.service.ContractService;
import org.flowable.engine.delegate.TaskListener;
import org.flowable.task.service.delegate.DelegateTask;
import org.springframework.stereotype.Component;

/**
 * Updates contract status based on task name when the task is created.
 * "approvedNotice" -> APPROVED, "rejectedNotice" -> REJECTED
 */
@Component("contractStatusListener")
public class ContractStatusListener implements TaskListener {

    private final ContractService contractService;

    public ContractStatusListener(ContractService contractService) {
        this.contractService = contractService;
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
        }
    }
}
