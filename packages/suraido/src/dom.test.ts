import { expect, test } from "vite-plus/test";
import {
  render,
  type Child,
  type ComponentContext,
  type ComponentObject,
} from "./dom.ts";
import { jsx } from "./jsx-runtime.ts";

const h = (type: any, props: Record<string, any> = {}, ...kids: any[]) =>
  jsx(type, kids.length ? { ...props, children: kids.length === 1 ? kids[0] : kids } : props);

const root = () => document.createElement("div");
const tick = () => new Promise((r) => setTimeout(r, 0));

type BoxState = { n: number };
const Box: ComponentObject<{ label: string }, BoxState> = {
  state: () => ({ n: 0 }),
  view(ctx): Child {
    return h(
      "div",
      {},
      h("img", { src: "/cat.png" }),
      h("span", {}, `${ctx.props.label}:${ctx.state.n}`),
      ctx.state.n > 0 ? h("p", {}, "extra") : null,
    );
  },
};

test("setState re-renders the subtree", async () => {
  const el = root();
  const box = render(h(Box, { label: "a" }), el).comp!.context as ComponentContext<
    { label: string },
    BoxState
  >;
  expect(el.querySelector("span")!.textContent).toBe("a:0");

  box.setState({ n: 1 });
  await tick();
  expect(el.querySelector("span")!.textContent).toBe("a:1");
});

test("setState rebuilds nodes rather than diffing them", async () => {
  const el = root();
  const box = render(h(Box, { label: "a" }), el).comp!.context as ComponentContext<
    { label: string },
    BoxState
  >;
  const img = el.querySelector("img");

  box.setState({ n: 1 });
  await tick();
  expect(el.querySelector("img")).not.toBe(img);
});

test("a child can appear and disappear without disturbing its siblings", async () => {
  const el = root();
  const box = render(h(Box, { label: "a" }), el).comp!.context as ComponentContext<
    { label: string },
    BoxState
  >;
  expect(el.querySelector("p")).toBe(null);

  box.setState({ n: 1 });
  await tick();
  expect(el.querySelector("p")!.textContent).toBe("extra");
  expect(el.querySelector("span")!.textContent).toBe("a:1");

  box.setState({ n: 0 });
  await tick();
  expect(el.querySelector("p")).toBe(null);
  expect(el.querySelector("span")!.textContent).toBe("a:0");
});

test("handlers survive the rebuild they caused, and do not stack", async () => {
  const Counter: ComponentObject<{}, { n: number }> = {
    state: () => ({ n: 0 }),
    view(ctx): Child {
      return h(
        "button",
        { onClick: () => ctx.setState((s) => ({ n: s.n + 1 })) },
        String(ctx.state.n),
      );
    },
  };

  const el = root();
  render(h(Counter, {}), el);
  for (let i = 0; i < 3; i++) {
    el.querySelector("button")!.dispatchEvent(new Event("click"));
    await tick();
  }
  expect(el.querySelector("button")!.textContent).toBe("3");
});

test("lists shrink correctly and dropped props are gone", () => {
  const el = root();
  const list = (items: string[], cls?: string) =>
    h("ul", { class: cls }, ...items.map((t) => h("li", {}, t)));

  render(list(["a", "b", "c"], "x"), el);
  expect(el.querySelectorAll("li").length).toBe(3);
  expect(el.querySelector("ul")!.getAttribute("class")).toBe("x");

  render(list(["a"], undefined), el);
  expect(el.querySelectorAll("li").length).toBe(1);
  expect(el.querySelector("ul")!.hasAttribute("class")).toBe(false);
});

test("updated() fires after the DOM has been rebuilt, so focus can be restored", async () => {
  const el = root();
  const seen: string[] = [];

  const Form: ComponentObject<{}, { n: number }> = {
    state: () => ({ n: 0 }),
    updated() {
      seen.push(el.querySelector("span")!.textContent!);
    },
    view(ctx): Child {
      return h("div", {}, h("input", {}), h("span", {}, String(ctx.state.n)));
    },
  };

  const form = render(h(Form, {}), el).comp!.context as ComponentContext<{}, { n: number }>;
  expect(seen).toEqual([]);

  form.setState({ n: 1 });
  await tick();
  expect(seen).toEqual(["1"]);

  form.setState({ n: 2 });
  await tick();
  expect(seen).toEqual(["1", "2"]);
});

test("unmounted() fires when a component leaves the tree", async () => {
  const el = root();
  const log: string[] = [];

  const Timer: ComponentObject = {
    mounted() {
      log.push("in");
    },
    unmounted() {
      log.push("out");
    },
    view(): Child {
      return h("i", {}, "tick");
    },
  };

  const Host: ComponentObject<{}, { show: boolean }> = {
    state: () => ({ show: true }),
    view(ctx): Child {
      return h("div", {}, ctx.state.show ? h(Timer, {}) : null);
    },
  };

  const host = render(h(Host, {}), el).comp!.context as ComponentContext<{}, { show: boolean }>;
  await tick();
  expect(log).toEqual(["in"]);

  host.setState({ show: false });
  await tick();
  expect(log).toEqual(["in", "out"]);
  expect(el.querySelector("i")).toBe(null);
});
