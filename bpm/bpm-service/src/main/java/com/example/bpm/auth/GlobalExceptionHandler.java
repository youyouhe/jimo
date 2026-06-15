package com.example.bpm.auth;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.Map;

/**
 * Global exception handler — converts Java exceptions into proper HTTP responses.
 */
@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<?> handleSecurityException(SecurityException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Result.fail(403, e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<?> handleIllegalArgumentException(IllegalArgumentException e) {
        String msg = e.getMessage();
        int code = msg != null && msg.startsWith("Contract") ? 404 : 400;
        return ResponseEntity.status(code == 404 ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST)
                .body(Result.fail(code, msg));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleGenericException(Exception e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Result.fail(500, e.getMessage() != null ? e.getMessage() : "Internal server error"));
    }
}
