import { describe, it, expect } from "vitest";
import {
  isNonEmptyString,
  asNonEmptyString,
  isPositiveNumber,
  asPositiveNumber,
} from "../types.js";

describe("types - Branded Type Guards and Assertions", () => {
  // ===========================================================================
  // isNonEmptyString
  // ===========================================================================
  describe("isNonEmptyString", () => {
    it("returns true for non-empty string", () => {
      expect(isNonEmptyString("hello")).toBe(true);
      expect(isNonEmptyString("a")).toBe(true);
      expect(isNonEmptyString("   ")).toBe(true); // whitespace is non-empty
    });

    it("returns false for empty string", () => {
      expect(isNonEmptyString("")).toBe(false);
    });

    it("returns false for null and undefined", () => {
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(undefined)).toBe(false);
    });

    it("returns false for non-string types", () => {
      expect(isNonEmptyString(123)).toBe(false);
      expect(isNonEmptyString(0)).toBe(false);
      expect(isNonEmptyString(true)).toBe(false);
      expect(isNonEmptyString({})).toBe(false);
      expect(isNonEmptyString([])).toBe(false);
    });
  });

  // ===========================================================================
  // asNonEmptyString
  // ===========================================================================
  describe("asNonEmptyString", () => {
    it("returns the string for valid non-empty string", () => {
      const result = asNonEmptyString("hello");
      expect(result).toBe("hello");
    });

    it("throws Error for empty string", () => {
      expect(() => asNonEmptyString("")).toThrow("String cannot be empty");
    });

    it("throws Error for falsy string value", () => {
      // TypeScript requires string type, but runtime behavior matters
      // Testing with type assertion to verify runtime guard
      expect(() => asNonEmptyString("" as string)).toThrow(
        "String cannot be empty"
      );
    });
  });

  // ===========================================================================
  // isPositiveNumber
  // ===========================================================================
  describe("isPositiveNumber", () => {
    it("returns true for positive numbers", () => {
      expect(isPositiveNumber(1)).toBe(true);
      expect(isPositiveNumber(42)).toBe(true);
      expect(isPositiveNumber(0.001)).toBe(true);
      expect(isPositiveNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    it("returns false for zero", () => {
      expect(isPositiveNumber(0)).toBe(false);
    });

    it("returns false for negative numbers", () => {
      expect(isPositiveNumber(-1)).toBe(false);
      expect(isPositiveNumber(-0.001)).toBe(false);
      expect(isPositiveNumber(-Infinity)).toBe(false);
    });

    it("returns false for NaN", () => {
      expect(isPositiveNumber(NaN)).toBe(false);
    });

    it("returns false for Infinity (not finite)", () => {
      expect(isPositiveNumber(Infinity)).toBe(false);
      expect(isPositiveNumber(-Infinity)).toBe(false);
    });

    it("returns false for non-number types", () => {
      expect(isPositiveNumber("123")).toBe(false);
      expect(isPositiveNumber("")).toBe(false);
      expect(isPositiveNumber(null)).toBe(false);
      expect(isPositiveNumber(undefined)).toBe(false);
      expect(isPositiveNumber({})).toBe(false);
      expect(isPositiveNumber([])).toBe(false);
    });
  });

  // ===========================================================================
  // asPositiveNumber
  // ===========================================================================
  describe("asPositiveNumber", () => {
    it("returns the number for valid positive number", () => {
      expect(asPositiveNumber(42)).toBe(42);
      expect(asPositiveNumber(0.5)).toBe(0.5);
    });

    it("throws Error for zero", () => {
      expect(() => asPositiveNumber(0)).toThrow("Number must be positive");
    });

    it("throws Error for negative numbers", () => {
      expect(() => asPositiveNumber(-1)).toThrow("Number must be positive");
      expect(() => asPositiveNumber(-100)).toThrow("Number must be positive");
    });

    it("throws Error for non-finite numbers", () => {
      expect(() => asPositiveNumber(Infinity)).toThrow(
        "Number must be positive"
      );
      expect(() => asPositiveNumber(NaN)).toThrow("Number must be positive");
    });
  });
});
