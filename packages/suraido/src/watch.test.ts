import { expect, test } from "vite-plus/test";
import {
  render,
  type Child,
  type ComponentContext,
  type ComponentObject,
} from "./dom.ts";
import { jsx } from "./jsx-runtime.ts";

function source() {
  const runs = new Set<() => void>();
  return {
    subscribers: runs,
    change: () => runs.forEach((r) => r()),
    subscribe(run: () => void) {
      runs.add(run);
      return () => runs.delete(run);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("a watching component redraws when the source changes", async () => {
  const from = source();
  let seen = 0;

  const Readout: ComponentObject = {
    mounted(ctx) {
      ctx.watch(from);
    },
    view(): Child {
      seen++;
      return jsx("b", { children: String(seen) });
    },
  };

  const host = document.createElement("div");
  render(jsx(Readout, {}), host);
  await tick();
  expect(seen).toBe(1);

  from.change();
  await tick();
  expect(seen).toBe(2);
});

test("leaving lets the source go", async () => {
  const from = source();

  const Readout: ComponentObject = {
    mounted(ctx) {
      ctx.watch(from);
    },
    view(): Child {
      return jsx("b", { children: "x" });
    },
  };

  const Host: ComponentObject<{}, { show: boolean }> = {
    state: () => ({ show: true }),
    view(ctx): Child {
      return jsx("div", { children: ctx.state.show ? jsx(Readout, {}) : null });
    },
  };

  const el = document.createElement("div");
  const host = render(jsx(Host, {}), el).comp!.context as ComponentContext<{}, { show: boolean }>;
  await tick();
  expect(from.subscribers.size).toBe(1);

  host.setState({ show: false });
  await tick();
  expect(from.subscribers.size).toBe(0);
});
