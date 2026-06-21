package com.example.bpm.webhook;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * Provides the {@link RestTemplate} used to push approval outcomes to the
 * NestJS low-code platform. Spring Boot 2.7 does not auto-configure a
 * RestTemplate bean, so we declare one with bounded timeouts.
 */
@Configuration
public class WebhookConfig {

    @Bean
    public RestTemplate restTemplate(
            RestTemplateBuilder builder,
            @Value("${nestjs.callback.timeout:5000}") long timeoutMs) {
        Duration timeout = Duration.ofMillis(timeoutMs);
        return builder
                .setConnectTimeout(timeout)
                .setReadTimeout(timeout)
                .build();
    }
}
