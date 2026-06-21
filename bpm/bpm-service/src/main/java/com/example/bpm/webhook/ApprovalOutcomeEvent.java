package com.example.bpm.webhook;

/**
 * Carries a contract approval outcome from the Flowable status listener to the
 * webhook publisher. Published from within the Flowable transaction so the
 * {@link ApprovalWebhookPublisher} (AFTER_COMMIT) only fires once the BPM DB
 * state change has durably committed — a NestJS outage cannot roll back the
 * Flowable state.
 */
public record ApprovalOutcomeEvent(
        String businessType,
        String businessId,
        String processInstanceId,
        String status,
        String initiatorId,
        String approverId,
        String comment,
        long occurredAt
) {
}
