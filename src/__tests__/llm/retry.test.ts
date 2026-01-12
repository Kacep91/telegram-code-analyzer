import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { retryWithBackoff, isRetryableError } from "../../llm/retry.js";

// =============================================================================
// Тесты для модуля retry.ts
// =============================================================================

describe("retry.ts", () => {
  // ===========================================================================
  // Тесты для retryWithBackoff
  // ===========================================================================

  describe("retryWithBackoff", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("должен вернуть результат при успешном выполнении с первой попытки", async () => {
      // ARRANGE
      const expectedResult = "success";
      const fn = vi.fn().mockResolvedValue(expectedResult);

      // ACT
      const promise = retryWithBackoff(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      // ASSERT
      expect(result).toBe(expectedResult);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("должен выполнить повторную попытку при ретрайабельной ошибке и вернуть результат", async () => {
      // ARRANGE
      const expectedResult = "success after retry";
      const retryableError = new Error("429 Too Many Requests");
      const fn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue(expectedResult);

      // ACT
      const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1000 });
      await vi.runAllTimersAsync();
      const result = await promise;

      // ASSERT
      expect(result).toBe(expectedResult);
      expect(fn).toHaveBeenCalledTimes(3); // 2 failed + 1 success
    });

    it("должен выбросить ошибку после исчерпания всех попыток", async () => {
      // ARRANGE
      const retryableError = new Error("503 Service Unavailable");
      const fn = vi.fn().mockRejectedValue(retryableError);

      // ACT
      const promise = retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 100 });
      const runTimers = vi.runAllTimersAsync();

      // ASSERT
      await expect(Promise.all([promise, runTimers])).rejects.toThrow(
        "503 Service Unavailable"
      );

      expect(fn).toHaveBeenCalledTimes(3); // maxRetries=2 -> 3 попытки (0, 1, 2)
    });

    it("должен немедленно выбросить ошибку при нереретрайабельной ошибке", async () => {
      // ARRANGE
      const nonRetryableError = new Error("401 Invalid API key");
      const fn = vi.fn().mockRejectedValue(nonRetryableError);

      // ACT
      const promise = retryWithBackoff(fn, { maxRetries: 3 });
      const runTimers = vi.runAllTimersAsync();

      // ASSERT
      await expect(Promise.all([promise, runTimers])).rejects.toThrow(
        "401 Invalid API key"
      );

      expect(fn).toHaveBeenCalledTimes(1); // Только 1 попытка
    });

    it("должен использовать экспоненциальную задержку с удвоением", async () => {
      // ARRANGE
      const retryableError = new Error("rate limit exceeded");
      const fn = vi.fn().mockRejectedValue(retryableError);
      const onRetry = vi.fn();

      // ACT
      const promise = retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        onRetry,
      });

      const runTimers = vi.runAllTimersAsync();

      try {
        await Promise.all([promise, runTimers]);
      } catch {
        // Ожидаем ошибку
      }

      // ASSERT
      // Попытка 1: delay = 1000 * 2^0 = 1000ms
      // Попытка 2: delay = 1000 * 2^1 = 2000ms
      // Попытка 3: delay = 1000 * 2^2 = 4000ms
      expect(onRetry).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenNthCalledWith(
        1,
        1,
        expect.any(Error),
        1000
      );
      expect(onRetry).toHaveBeenNthCalledWith(
        2,
        2,
        expect.any(Error),
        2000
      );
      expect(onRetry).toHaveBeenNthCalledWith(
        3,
        3,
        expect.any(Error),
        4000
      );
    });

    it("должен ограничить максимальную задержку параметром maxDelayMs", async () => {
      // ARRANGE
      const retryableError = new Error("timeout");
      const fn = vi.fn().mockRejectedValue(retryableError);
      const onRetry = vi.fn();

      // ACT
      const promise = retryWithBackoff(fn, {
        maxRetries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 3000, // Лимит на 3000ms
        onRetry,
      });

      const runTimers = vi.runAllTimersAsync();

      try {
        await Promise.all([promise, runTimers]);
      } catch {
        // Ожидаем ошибку
      }

      // ASSERT
      // Попытка 1: delay = min(1000 * 2^0, 3000) = 1000ms
      // Попытка 2: delay = min(1000 * 2^1, 3000) = 2000ms
      // Попытка 3: delay = min(1000 * 2^2, 3000) = 3000ms (cap)
      // Попытка 4: delay = min(1000 * 2^3, 3000) = 3000ms (cap)
      // Попытка 5: delay = min(1000 * 2^4, 3000) = 3000ms (cap)
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error), 1000);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error), 2000);
      expect(onRetry).toHaveBeenNthCalledWith(3, 3, expect.any(Error), 3000);
      expect(onRetry).toHaveBeenNthCalledWith(4, 4, expect.any(Error), 3000);
      expect(onRetry).toHaveBeenNthCalledWith(5, 5, expect.any(Error), 3000);
    });

    it("должен вызывать onRetry колбэк с корректными аргументами", async () => {
      // ARRANGE
      const retryableError = new Error("502 Bad Gateway");
      const fn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue("success");
      const onRetry = vi.fn();

      // ACT
      const promise = retryWithBackoff(fn, {
        maxRetries: 2,
        baseDelayMs: 500,
        onRetry,
      });

      await vi.runAllTimersAsync();
      await promise;

      // ASSERT
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        1, // attempt number
        retryableError, // error
        500 // delay in ms
      );
    });

    it("должен прервать retry при отмене через AbortSignal", async () => {
      // ARRANGE
      const retryableError = new Error("503 Service Unavailable");
      const fn = vi.fn().mockRejectedValue(retryableError);
      const controller = new AbortController();

      // ACT
      const promise = retryWithBackoff(fn, {
        maxRetries: 5,
        baseDelayMs: 1000,
        signal: controller.signal,
      });

      // Отменяем после первой попытки
      setTimeout(() => controller.abort(), 0);

      const runTimers = vi.runAllTimersAsync();

      // ASSERT
      await expect(Promise.all([promise, runTimers])).rejects.toThrow(
        "Retry cancelled"
      );
    });

    it("должен выбросить 'Retry cancelled' при уже отмененном AbortSignal", async () => {
      // ARRANGE
      const controller = new AbortController();
      controller.abort(); // Отменяем заранее
      const fn = vi.fn().mockResolvedValue("should not be called");

      // ACT
      const promise = retryWithBackoff(fn, {
        maxRetries: 3,
        signal: controller.signal,
      });

      const runTimers = vi.runAllTimersAsync();

      // ASSERT
      await expect(Promise.all([promise, runTimers])).rejects.toThrow(
        "Retry cancelled"
      );

      expect(fn).not.toHaveBeenCalled();
    });

    it("должен преобразовать не-Error исключение в Error", async () => {
      // ARRANGE
      const fn = vi.fn().mockRejectedValue("string error");

      // ACT
      const promise = retryWithBackoff(fn, { maxRetries: 0 });
      const runTimers = vi.runAllTimersAsync();

      // ASSERT
      await expect(Promise.all([promise, runTimers])).rejects.toThrow(
        "string error"
      );
    });

    it("должен использовать дефолтные значения для опций", async () => {
      // ARRANGE
      const retryableError = new Error("timeout");
      const fn = vi.fn().mockRejectedValue(retryableError);

      // ACT
      const promise = retryWithBackoff(fn); // Без опций
      const runTimers = vi.runAllTimersAsync();

      try {
        await Promise.all([promise, runTimers]);
      } catch {
        // Ожидаем ошибку
      }

      // ASSERT
      // Дефолтные значения: maxRetries=3, baseDelayMs=1000
      expect(fn).toHaveBeenCalledTimes(4); // 0, 1, 2, 3
    });
  });

  // ===========================================================================
  // Тесты для isRetryableError
  // ===========================================================================

  describe("isRetryableError", () => {
    describe("должен определить rate limit ошибки как ретрайабельные", () => {
      it("должен вернуть true для '429 Too Many Requests'", () => {
        // ARRANGE
        const error = new Error("429 Too Many Requests");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'rate limit exceeded'", () => {
        // ARRANGE
        const error = new Error("rate limit exceeded");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'rate_limit'", () => {
        // ARRANGE
        const error = new Error("API rate_limit hit");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'quota exceeded'", () => {
        // ARRANGE
        const error = new Error("quota exceeded for this API");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'RESOURCE_EXHAUSTED'", () => {
        // ARRANGE
        const error = new Error("RESOURCE_EXHAUSTED: quota limit");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });
    });

    describe("должен определить серверные ошибки (5xx) как ретрайабельные", () => {
      it("должен вернуть true для '500 Internal Server Error'", () => {
        // ARRANGE
        const error = new Error("500 Internal Server Error");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для '502 Bad Gateway'", () => {
        // ARRANGE
        const error = new Error("502 Bad Gateway");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для '503 Service Unavailable'", () => {
        // ARRANGE
        const error = new Error("503 Service Unavailable");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для '504 Gateway Timeout'", () => {
        // ARRANGE
        const error = new Error("504 Gateway Timeout");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });
    });

    describe("должен определить network/timeout ошибки как ретрайабельные", () => {
      it("должен вернуть true для 'timeout'", () => {
        // ARRANGE
        const error = new Error("Request timeout");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'timed out'", () => {
        // ARRANGE
        const error = new Error("Connection timed out");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'ETIMEDOUT'", () => {
        // ARRANGE
        const error = new Error("ETIMEDOUT: network timeout");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'ECONNRESET'", () => {
        // ARRANGE
        const error = new Error("ECONNRESET: connection reset by peer");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'ECONNREFUSED'", () => {
        // ARRANGE
        const error = new Error("ECONNREFUSED: connection refused");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'socket hang up'", () => {
        // ARRANGE
        const error = new Error("socket hang up");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'network error'", () => {
        // ARRANGE
        const error = new Error("network error occurred");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'fetch failed'", () => {
        // ARRANGE
        const error = new Error("fetch failed");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'connection reset'", () => {
        // ARRANGE
        const error = new Error("connection reset by server");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'aborted'", () => {
        // ARRANGE
        const error = new Error("Request aborted");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });
    });

    describe("должен определить service unavailable ошибки как ретрайабельные", () => {
      it("должен вернуть true для 'service unavailable'", () => {
        // ARRANGE
        const error = new Error("service unavailable");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'temporarily unavailable'", () => {
        // ARRANGE
        const error = new Error("Service temporarily unavailable");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'overloaded'", () => {
        // ARRANGE
        const error = new Error("Server overloaded");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });
    });

    describe("должен определить нереретрайабельные ошибки", () => {
      it("должен вернуть false для '401 Unauthorized'", () => {
        // ARRANGE
        const error = new Error("401 Unauthorized");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для '403 Forbidden'", () => {
        // ARRANGE
        const error = new Error("403 Forbidden");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для '404 Not Found'", () => {
        // ARRANGE
        const error = new Error("404 Not Found");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для '400 Bad Request'", () => {
        // ARRANGE
        const error = new Error("400 Bad Request");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для 'Invalid API key'", () => {
        // ARRANGE
        const error = new Error("Invalid API key");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для произвольной ошибки", () => {
        // ARRANGE
        const error = new Error("Something went wrong");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });
    });

    describe("должен обработать не-Error объекты", () => {
      it("должен вернуть false для строки", () => {
        // ARRANGE
        const error = "string error";

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для null", () => {
        // ARRANGE
        const error = null;

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для undefined", () => {
        // ARRANGE
        const error = undefined;

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для обычного объекта", () => {
        // ARRANGE
        const error = { message: "timeout" };

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });

      it("должен вернуть false для числа", () => {
        // ARRANGE
        const error = 429;

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(false);
      });
    });

    describe("должен быть регистронезависимым при проверке сообщений", () => {
      it("должен вернуть true для 'TIMEOUT' (верхний регистр)", () => {
        // ARRANGE
        const error = new Error("REQUEST TIMEOUT");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });

      it("должен вернуть true для 'Rate Limit Exceeded' (смешанный регистр)", () => {
        // ARRANGE
        const error = new Error("Rate Limit Exceeded");

        // ACT & ASSERT
        expect(isRetryableError(error)).toBe(true);
      });
    });
  });
});
