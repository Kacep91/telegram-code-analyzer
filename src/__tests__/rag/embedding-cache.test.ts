import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingCache } from "../../rag/embedding-cache.js";
import type { LLMEmbeddingProvider, EmbeddingResult } from "../../llm/types.js";

// Моковый провайдер для тестирования
function createMockEmbeddingProvider(): LLMEmbeddingProvider {
  return {
    embed: vi.fn().mockImplementation((_text: string) =>
      Promise.resolve({
        values: [0.1, 0.2, 0.3],
        tokenCount: 10,
        model: "test-model",
      } as EmbeddingResult)
    ),
    embedBatch: vi.fn(),
  };
}

describe("EmbeddingCache", () => {
  let provider: LLMEmbeddingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createMockEmbeddingProvider();
  });

  describe("getOrEmbed() - cache hit", () => {
    it("должен вернуть кешированный результат без вызова провайдера", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();
      const text = "test query";

      // ACT - первый запрос для заполнения кеша
      await cache.getOrEmbed(text, provider);
      expect(provider.embed).toHaveBeenCalledTimes(1);

      // ACT - второй запрос должен вернуть из кеша
      const result = await cache.getOrEmbed(text, provider);

      // ASSERT
      expect(provider.embed).toHaveBeenCalledTimes(1); // Не вызывается снова
      expect(result.values).toEqual([0.1, 0.2, 0.3]);
      expect(result.tokenCount).toBe(10);
    });

    it("должен увеличить счётчик попаданий в кеш", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();
      const text = "test query";

      // ACT
      await cache.getOrEmbed(text, provider);
      await cache.getOrEmbed(text, provider); // cache hit

      // ASSERT
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe("getOrEmbed() - cache miss", () => {
    it("должен вызвать provider.embed() для нового текста", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();
      const text = "new query";

      // ACT
      const result = await cache.getOrEmbed(text, provider);

      // ASSERT
      expect(provider.embed).toHaveBeenCalledWith(text);
      expect(result.values).toEqual([0.1, 0.2, 0.3]);
    });

    it("должен добавить результат в кеш", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();
      const text = "new query";

      // ACT
      await cache.getOrEmbed(text, provider);

      // ASSERT
      expect(cache.size).toBe(1);
      const stats = cache.getStats();
      expect(stats.size).toBe(1);
    });

    it("должен увеличить счётчик промахов", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();

      // ACT
      await cache.getOrEmbed("query1", provider);
      await cache.getOrEmbed("query2", provider);

      // ASSERT
      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
      expect(stats.hits).toBe(0);
    });
  });

  describe("Single-flight pattern", () => {
    it("должен вызвать provider.embed() только один раз для одновременных запросов", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();
      const text = "concurrent query";

      // Создаём провайдер с задержкой для симуляции реального API
      let resolveEmbed: (value: EmbeddingResult) => void;
      const embedPromise = new Promise<EmbeddingResult>((resolve) => {
        resolveEmbed = resolve;
      });

      const slowProvider: LLMEmbeddingProvider = {
        embed: vi.fn().mockReturnValue(embedPromise),
        embedBatch: vi.fn(),
      };

      // ACT - два одновременных запроса
      const promise1 = cache.getOrEmbed(text, slowProvider);
      const promise2 = cache.getOrEmbed(text, slowProvider);

      // Завершаем запрос
      resolveEmbed!({
        values: [0.5, 0.6, 0.7],
        tokenCount: 15,
        model: "slow-model",
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // ASSERT
      expect(slowProvider.embed).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
      expect(result1.values).toEqual([0.5, 0.6, 0.7]);
    });

    it("должен засчитать второй запрос как hit", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();
      const text = "concurrent query";

      let resolveEmbed: (value: EmbeddingResult) => void;
      const embedPromise = new Promise<EmbeddingResult>((resolve) => {
        resolveEmbed = resolve;
      });

      const slowProvider: LLMEmbeddingProvider = {
        embed: vi.fn().mockReturnValue(embedPromise),
        embedBatch: vi.fn(),
      };

      // ACT
      const promise1 = cache.getOrEmbed(text, slowProvider);
      const promise2 = cache.getOrEmbed(text, slowProvider);

      resolveEmbed!({
        values: [0.5, 0.6, 0.7],
        tokenCount: 15,
        model: "slow-model",
      });

      await Promise.all([promise1, promise2]);

      // ASSERT
      const stats = cache.getStats();
      expect(stats.misses).toBe(1); // Первый запрос - miss
      expect(stats.hits).toBe(1); // Второй запрос - hit (single-flight)
    });
  });

  describe("LRU eviction", () => {
    it("должен удалить самый старый элемент при превышении maxSize", async () => {
      // ARRANGE
      const maxSize = 3;
      const cache = new EmbeddingCache(maxSize);

      // ACT - заполняем кеш до лимита
      await cache.getOrEmbed("query1", provider);
      await cache.getOrEmbed("query2", provider);
      await cache.getOrEmbed("query3", provider);

      expect(cache.size).toBe(3);

      // ACT - добавляем четвёртый элемент
      await cache.getOrEmbed("query4", provider);

      // ASSERT - размер не изменился, самый старый удалён
      expect(cache.size).toBe(3);
      expect(provider.embed).toHaveBeenCalledTimes(4);
    });

    it("должен правильно обновлять LRU порядок при повторном доступе", async () => {
      // ARRANGE
      const maxSize = 3;
      const cache = new EmbeddingCache(maxSize);

      // ACT - заполняем кеш
      await cache.getOrEmbed("query1", provider);
      await cache.getOrEmbed("query2", provider);
      await cache.getOrEmbed("query3", provider);

      // ACT - обращаемся к query1, она перемещается в конец
      await cache.getOrEmbed("query1", provider);

      // ACT - добавляем query4, должна удалиться query2 (самая старая)
      await cache.getOrEmbed("query4", provider);

      // ASSERT - проверяем что query1 всё ещё в кеше
      vi.clearAllMocks();
      await cache.getOrEmbed("query1", provider);
      expect(provider.embed).not.toHaveBeenCalled(); // query1 в кеше
    });
  });

  describe("clear()", () => {
    it("должен очистить кеш", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();
      await cache.getOrEmbed("query1", provider);
      await cache.getOrEmbed("query2", provider);

      expect(cache.size).toBe(2);

      // ACT
      cache.clear();

      // ASSERT
      expect(cache.size).toBe(0);
    });

    it("должен сбросить метрики", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();
      await cache.getOrEmbed("query1", provider);
      await cache.getOrEmbed("query1", provider); // hit

      let stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);

      // ACT
      cache.clear();

      // ASSERT
      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("должен очистить pending запросы", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();

      let resolveEmbed: (value: EmbeddingResult) => void;
      const embedPromise = new Promise<EmbeddingResult>((resolve) => {
        resolveEmbed = resolve;
      });

      const slowProvider: LLMEmbeddingProvider = {
        embed: vi.fn().mockReturnValue(embedPromise),
        embedBatch: vi.fn(),
      };

      const promise = cache.getOrEmbed("pending query", slowProvider);

      // ACT - очищаем кеш до завершения запроса
      cache.clear();

      // ASSERT - pending-карта очищена
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);

      // Завершаем запрос - результат попадет в кеш (это ожидаемое поведение)
      resolveEmbed!({
        values: [0.1, 0.2, 0.3],
        tokenCount: 10,
        model: "test",
      });

      await promise;

      // После завершения pending-запроса результат добавляется в кеш
      expect(cache.size).toBe(1);
    });
  });

  describe("getStats()", () => {
    it("должен вернуть корректные метрики", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();

      // ACT
      await cache.getOrEmbed("query1", provider); // miss
      await cache.getOrEmbed("query2", provider); // miss
      await cache.getOrEmbed("query1", provider); // hit
      await cache.getOrEmbed("query2", provider); // hit

      // ASSERT
      const stats = cache.getStats();
      expect(stats.size).toBe(2);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });

    it("должен вернуть hitRate = 0 для пустого кеша", () => {
      // ARRANGE
      const cache = new EmbeddingCache();

      // ACT
      const stats = cache.getStats();

      // ASSERT
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it("должен корректно считать hitRate только с hits", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();

      // ACT
      await cache.getOrEmbed("query1", provider); // miss
      await cache.getOrEmbed("query1", provider); // hit
      await cache.getOrEmbed("query1", provider); // hit
      await cache.getOrEmbed("query1", provider); // hit

      // ASSERT
      const stats = cache.getStats();
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.75);
    });
  });

  describe("size property", () => {
    it("должен вернуть количество элементов в кеше", async () => {
      // ARRANGE
      const cache = new EmbeddingCache();

      // ACT & ASSERT
      expect(cache.size).toBe(0);

      await cache.getOrEmbed("query1", provider);
      expect(cache.size).toBe(1);

      await cache.getOrEmbed("query2", provider);
      expect(cache.size).toBe(2);

      await cache.getOrEmbed("query1", provider); // hit, size не изменится
      expect(cache.size).toBe(2);
    });
  });
});
