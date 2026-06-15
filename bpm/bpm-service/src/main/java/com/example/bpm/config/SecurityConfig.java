package com.example.bpm.config;

import com.example.bpm.auth.AuthInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Security configuration for internal microservice.
 * Registers AuthInterceptor to extract user context from headers
 * set by the Go backend gateway.
 */
@Configuration
public class SecurityConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;

    public SecurityConfig(AuthInterceptor authInterceptor) {
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/health");
    }
}
