import { describe, expect, it } from "vitest";
import { isExecId, parseContentResponse, parsePingRequest } from "./messages";

const ID = "0b6f2a3c-1d4e-4f5a-8b9c-0d1e2f3a4b5c";

describe("isExecId", () => {
  it("accepts a lowercase UUID v4", () => {
    expect(isExecId(ID)).toBe(true);
  });

  it.each([
    ["uppercase", ID.toUpperCase()],
    ["version 1", "0b6f2a3c-1d4e-1f5a-8b9c-0d1e2f3a4b5c"],
    ["trailing text", `${ID}x`],
    ["leading text", `x${ID}`],
    ["path traversal", "../conversations"],
    ["number", 42],
  ])("rejects %s", (_label, value) => {
    expect(isExecId(value)).toBe(false);
  });
});

describe("parsePingRequest", () => {
  const ok = { v: 1, kind: "ping", execId: ID, expiresAt: 1_700_000_000_000 };

  it("accepts a well-formed request", () => {
    expect(parsePingRequest(ok)).toEqual(ok);
  });

  it.each([
    ["extra key", { ...ok, target: "x" }],
    ["missing key", { v: 1, kind: "ping", execId: ID }],
    ["wrong version", { ...ok, v: 2 }],
    ["wrong kind", { ...ok, kind: "commit" }],
    ["bad execId", { ...ok, execId: "abc" }],
    ["fractional expiry", { ...ok, expiresAt: 1.5 }],
    ["string expiry", { ...ok, expiresAt: "1700000000000" }],
    ["array", [1, "ping", ID, 1]],
    ["null", null],
    ["string", "ping"],
  ])("rejects %s", (_label, value) => {
    expect(parsePingRequest(value)).toBeNull();
  });

  it("rejects an object with a non-plain prototype", () => {
    const value = Object.assign(Object.create({ inherited: true }), ok);
    expect(parsePingRequest(value)).toBeNull();
  });
});

describe("parseContentResponse", () => {
  it("accepts pong and error responses", () => {
    const pong = { v: 1, kind: "pong", execId: ID, origin: "https://chatgpt.com" };
    const error = { v: 1, kind: "error", execId: null, code: "bad-sender" };
    expect(parseContentResponse(pong)).toEqual(pong);
    expect(parseContentResponse(error)).toEqual(error);
  });

  it.each([
    ["unknown error code", { v: 1, kind: "error", execId: ID, code: "nope" }],
    ["pong with extra key", { v: 1, kind: "pong", execId: ID, origin: "x", extra: 1 }],
    ["pong without origin", { v: 1, kind: "pong", execId: ID }],
    ["error kind on pong shape", { v: 1, kind: "error", execId: ID, origin: "x" }],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(parseContentResponse(value)).toBeNull();
  });
});
