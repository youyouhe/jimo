package com.example.bpm.webhook;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.client.RestTemplate;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Pushes contract approval outcomes to the NestJS low-code platform via an
 * HMAC-signed webhook (POST {nestjs.callback.url}).
 *
 * <p>Listens {@code AFTER_COMMIT} so the HTTP call is decoupled from the Flowable
 * transaction; {@code fallbackExecution=true} guarantees delivery even when no
 * Spring transaction is active. The signed payload is {@code <timestamp>.<body>}
 * (hex HMAC-SHA256), matching NestJS's {@code BpmSignatureGuard}.</p>
 *
 * <p>BPM remains the source of truth for contract status. If delivery fails after
 * retries, the outcome is logged and NestJS lags until reconciliation (a durable
 * outbox/retry table is deferred to P1).</p>
 */
@Component
public class ApprovalWebhookPublisher {

    private static final Logger log = LoggerFactory.getLogger(ApprovalWebhookPublisher.class);
    private static final int MAX_ATTEMPTS = 3;

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final String url;
    private final String secret;
    private final boolean enabled;

    public ApprovalWebhookPublisher(
            RestTemplate restTemplate,
            ObjectMapper objectMapper,
            @Value("${nestjs.callback.url:}") String url,
            @Value("${nestjs.callback.secret:}") String secret,
            @Value("${nestjs.callback.enabled:true}") boolean enabled) {
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.url = url;
        this.secret = secret;
        this.enabled = enabled;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onApprovalOutcome(ApprovalOutcomeEvent event) {
        if (!enabled || isBlank(url) || isBlank(secret)) {
            log.debug("BPM→NestJS webhook disabled/unconfigured; skipping {} {}", event.businessId(), event.status());
            return;
        }
        deliver(event, 1);
    }

    private void deliver(ApprovalOutcomeEvent event, int attempt) {
        try {
            String body = objectMapper.writeValueAsString(toPayload(event));
            String timestamp = String.valueOf(System.currentTimeMillis());
            String signature = hmacSha256Hex(secret, timestamp + "." + body);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("X-BPM-Signature", signature);
            headers.set("X-BPM-Timestamp", timestamp);

            restTemplate.postForObject(url, new HttpEntity<>(body, headers), String.class);
            log.info("BPM→NestJS webhook delivered businessId={} status={} attempt={}",
                    event.businessId(), event.status(), attempt);
        } catch (Exception e) {
            log.error("BPM→NestJS webhook failed businessId={} status={} attempt={}: {}",
                    event.businessId(), event.status(), attempt, e.getMessage());
            if (attempt < MAX_ATTEMPTS) {
                deliver(event, attempt + 1); // best-effort inline retry for MVP
            }
            // Intentionally swallow: BPM DB is already committed; reconciliation in P1.
        }
    }

    private static Map<String, Object> toPayload(ApprovalOutcomeEvent e) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("businessType", e.businessType());
        payload.put("businessId", e.businessId());
        payload.put("processInstanceId", e.processInstanceId());
        payload.put("status", e.status());
        if (e.initiatorId() != null) payload.put("initiatorId", e.initiatorId());
        if (e.approverId() != null) payload.put("approverId", e.approverId());
        if (e.comment() != null) payload.put("comment", e.comment());
        payload.put("occurredAt", String.valueOf(e.occurredAt()));
        return payload;
    }

    private static String hmacSha256Hex(String secret, String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] hash = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
