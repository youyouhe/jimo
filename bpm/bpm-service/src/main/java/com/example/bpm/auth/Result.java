package com.example.bpm.auth;

/**
 * Result wrapper class for API responses.
 */
public class Result<T> {

    public int code;
    public String message;
    public T data;

    public static <T> Result<T> ok(T data) {
        Result<T> r = new Result<>();
        r.code = 0;
        r.message = "success";
        r.data = data;
        return r;
    }

    public static <T> Result<T> ok() {
        return ok(null);
    }

    public static <T> Result<T> fail(int code, String message) {
        Result<T> r = new Result<>();
        r.code = code;
        r.message = message;
        r.data = null;
        return r;
    }

    public static <T> Result<T> fail(String message) {
        return fail(1, message);
    }
}
