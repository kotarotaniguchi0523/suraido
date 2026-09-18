import { expect, test, vi } from "vite-plus/test";

async function mountDeck(hash: string, kind: "points" | "list" = "points") {
  location.hash = hash;
  vi.resetModules();

  const { slide, Step, deck } = await import("./deck.tsx");
  const { jsx } = await import("./jsx-runtime.ts");

  const Points = slide({ path: "points", steps: 3 }, () =>
    jsx(Step, { n: 1, children: jsx(Step, { n: 2, children: "x" }) }),
  );

  const List = slide({ path: "list", steps: 3 }, () =>
    jsx("ul", {
      children: [
        jsx(Step, { n: 1, children: jsx("li", { children: "a" }) }),
        jsx(Step, { n: 2, children: jsx("li", { children: "b" }) }),
      ],
    }),
  );

  const host = document.createElement("div");
  const context = deck([kind === "list" ? List : Points], { host });
  await new Promise((r) => setTimeout(r, 0));
  const result = {
    shown: [...host.querySelectorAll(".step")].map((e) => e.hasAttribute("data-shown")),
    hash: location.hash,
  };
  context.destroy();
  return result;
}

test("opening #points.2 from cold shows step 2 from the first render", async () => {
  const { shown, hash } = await mountDeck("#points.2");
  expect(shown).toEqual([true, true]);
  expect(hash).toBe("#points.2");
});

test("opening without a step shows nothing yet", async () => {
  const { shown } = await mountDeck("#points");
  expect(shown).toEqual([false, false]);
});

test("an out-of-range step is rounded, and the URL is normalised", async () => {
  const { shown, hash } = await mountDeck("#points.9");
  expect(shown).toEqual([true, true]);
  expect(hash).toBe("#points.2");
});
