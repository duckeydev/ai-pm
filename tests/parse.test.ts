import { describe, expect, it } from "vitest";
import { parseNotionId } from "@/lib/notion";

describe("parseNotionId", () => {
  it("accepts dashed uuid", () => {
    expect(parseNotionId("771fe81c-9775-4ba1-a77a-1785baaaee5e")).toBe(
      "771fe81c-9775-4ba1-a77a-1785baaaee5e",
    );
  });

  it("parses 32-hex from a Notion URL", () => {
    expect(parseNotionId("https://www.notion.so/My-Task-771fe81c97754ba1a77a1785baaaee5e")).toBe(
      "771fe81c-9775-4ba1-a77a-1785baaaee5e",
    );
  });
});
