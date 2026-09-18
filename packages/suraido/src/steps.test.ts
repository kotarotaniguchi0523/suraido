import { afterEach, expect, test } from "vite-plus/test";
import { deck as startDeck, defineSlide, slide, Step, type DeckContext, type SlideComponent } from "./deck.tsx";
import { flushSync } from "./dom.ts";
import { jsx } from "./jsx-runtime.ts";

const Points = slide({ path: "points", steps: 3 }, () =>
  jsx("div", {
    children: [jsx(Step, { n: 1, children: "a" }), jsx(Step, { n: 2, children: "b" })],
  }),
);

/** Something outside the slide that it redraws for: a vote arriving, a timer ticking. */
const votes = {
  count: 0,
  runs: new Set<() => void>(),
  subscribe(run: () => void) {
    this.runs.add(run);
    return () => void this.runs.delete(run);
  },
  cast() {
    this.count++;
    for (const run of this.runs) run();
  },
};

const Counting = defineSlide(
  { path: "counting", steps: 3 },
  {
    mounted(ctx) {
      ctx.watch(votes);
    },
    view() {
      return jsx("div", {
        children: [
          String(votes.count),
          jsx(Step, { n: 1, children: "a" }),
          jsx(Step, { n: 2, children: "b" }),
        ],
      });
    },
  },
);

const Listed = slide({ path: "listed", steps: 3 }, () =>
  jsx("ul", {
    children: [
      jsx(Step, { n: 1, children: jsx("li", { class: "lead", children: "a" }) }),
      jsx(Step, { n: 2, children: jsx("li", { children: "b" }) }),
    ],
  }),
);

/** Which reveals are showing, read the way the CSS reads them. */
const shownIn = (el: Element) =>
  [...el.querySelectorAll(".step[data-n]")].map((s) => s.hasAttribute("data-shown"));

/** mounted() runs on a microtask, and it is what normalises the URL. */
const tick = () => new Promise((r) => setTimeout(r, 0));

const attached: DeckContext[] = [];
async function mount(slides: SlideComponent[], hash = "") {
  location.hash = hash;
  const host = document.body.appendChild(document.createElement("div"));
  const deck = startDeck(slides, { host });
  attached.push(deck);
  await tick();
  return { deck, host };
}

afterEach(() => {
  for (const deck of attached.splice(0)) deck.destroy();
  document.body.innerHTML = "";
  votes.count = 0;
  votes.runs.clear();
});

test("two decks on one page keep their own step", async () => {
  const left = await mount([Points]);
  const right = await mount([Points]);

  left.deck.go({ index: 0, step: 2 });

  expect(shownIn(left.host)).toEqual([true, true]);
  expect(shownIn(right.host)).toEqual([false, false]);
});

test("a slide that redraws itself after stepping keeps its reveals", async () => {
  const { deck, host } = await mount([Counting]);

  deck.go({ index: 0, step: 2 });
  expect(shownIn(host)).toEqual([true, true]);

  votes.cast();
  flushSync();

  expect(host.textContent).toContain("1");
  expect(shownIn(host)).toEqual([true, true]);
});

test("a Step around an li lands directly under the ul", async () => {
  const { host } = await mount([Listed], "#listed.1");
  const ul = host.querySelector("ul")!;

  expect([...ul.children].map((c) => c.tagName.toLowerCase())).toEqual(["li", "li"]);
  expect(ul.querySelectorAll("div").length).toBe(0);
  expect(ul.querySelector('li.step[data-n="1"]')).toBeTruthy();
});

test("marking an element keeps the class it already had", async () => {
  const { host } = await mount([Listed], "#listed.1");
  expect(host.querySelector("li")!.className.split(" ").sort()).toEqual(["lead", "step"]);
});

test("a Step around bare text still gets something to hang the mark on", async () => {
  const { host } = await mount([Points], "#points.1");
  expect(host.querySelectorAll("div.step").length).toBe(2);
});

test("whitespace around the element does not stop it being marked", async () => {
  const Spaced = slide({ path: "spaced", steps: 2 }, () =>
    jsx("ul", {
      children: jsx(Step, { n: 1, children: [" ", jsx("li", { children: "a" }), " "] }),
    }),
  );

  const { host } = await mount([Spaced], "#spaced.1");
  expect([...host.querySelector("ul")!.children].map((c) => c.tagName.toLowerCase())).toEqual([
    "li",
  ]);
});

test("a Step with no number takes the one after the last", async () => {
  const Bare = slide({ path: "bare", steps: 4 }, () =>
    jsx("div", {
      children: [
        jsx(Step, { children: "a" }),
        jsx(Step, { children: "b" }),
        jsx(Step, { children: "c" }),
      ],
    }),
  );

  const { deck, host } = await mount([Bare], "#bare.2");
  expect(shownIn(host)).toEqual([true, true, false]);

  deck.go({ index: 0, step: 3 });
  expect(shownIn(host)).toEqual([true, true, true]);
});

test("naming a number carries the ones after it forward", async () => {
  const Mixed = slide({ path: "mixed", steps: 5 }, () =>
    jsx("div", {
      children: [jsx(Step, { n: 3, children: "a" }), jsx(Step, { children: "b" })],
    }),
  );

  const { deck, host } = await mount([Mixed], "#mixed.3");
  expect(shownIn(host)).toEqual([true, false]);

  deck.go({ index: 0, step: 4 });
  expect(shownIn(host)).toEqual([true, true]);
});

test("a range shows from the first number until the second, which is exclusive", async () => {
  const Ranged = slide({ path: "ranged", steps: 5 }, () =>
    jsx("div", { children: jsx(Step, { n: [2, 4], children: "a" }) }),
  );

  const { deck, host } = await mount([Ranged], "#ranged.1");
  expect(shownIn(host)).toEqual([false]);

  deck.go({ index: 0, step: 2 });
  expect(shownIn(host)).toEqual([true]);
  deck.go({ index: 0, step: 3 });
  expect(shownIn(host)).toEqual([true]);
  deck.go({ index: 0, step: 4 });
  expect(shownIn(host)).toEqual([false]);
});

test("a slide that redraws itself numbers its reveals the same way twice", async () => {
  const Bare = defineSlide(
    { path: "bare", steps: 3 },
    {
      mounted(ctx) {
        ctx.watch(votes);
      },
      view() {
        return jsx("div", {
          children: [
            String(votes.count),
            jsx(Step, { children: "a" }),
            jsx(Step, { children: "b" }),
          ],
        });
      },
    },
  );

  const { host } = await mount([Bare], "#bare.2");
  expect(shownIn(host)).toEqual([true, true]);

  votes.cast();
  flushSync();

  expect(host.querySelector('[data-n="1"]')).toBeTruthy();
  expect(shownIn(host)).toEqual([true, true]);
});

test("the reveal after a range arrives on the step the range leaves", async () => {
  const Swap = slide({ path: "swap", steps: 4 }, () =>
    jsx("div", {
      children: [jsx(Step, { n: [1, 3], children: "before" }), jsx(Step, { children: "after" })],
    }),
  );

  const { deck, host } = await mount([Swap], "#swap.1");
  expect(shownIn(host)).toEqual([true, false]);

  deck.go({ index: 0, step: 3 });
  expect(shownIn(host)).toEqual([false, true]);
});

const Three = slide({ path: "three" }, () =>
  jsx("div", {
    children: [
      jsx(Step, { children: "a" }),
      jsx(Step, { children: "b" }),
      jsx(Step, { children: "c" }),
    ],
  }),
);

const Plain = slide({ path: "plain" }, () => "nothing to reveal");

test("a slide with three reveals and nothing declared takes three presses", async () => {
  const { deck, host } = await mount([Three, Plain]);

  deck.move(1);
  deck.move(1);
  deck.move(1);
  expect(shownIn(host)).toEqual([true, true, true]);
  expect(deck.at.index).toBe(0);

  deck.move(1);
  expect(deck.at.index).toBe(1);
});

test("arrow-left into a slide never seen lands on its last step", async () => {
  const { deck, host } = await mount([Three, Plain], "#plain");

  deck.move(-1);
  await tick();

  expect(deck.at.index).toBe(0);
  expect(shownIn(host)).toEqual([true, true, true]);
  expect(location.hash).toBe("#three.3");
});

test("End lands on the last step of the last slide", async () => {
  const { deck } = await mount([Plain, Three]);

  deck.go({ index: 1, step: Number.POSITIVE_INFINITY });
  await tick();

  expect(location.hash).toBe("#three.3");
});

test("a deep link past the end is brought back once the slide has been drawn", async () => {
  const { host } = await mount([Three], "#three.9");

  expect(shownIn(host)).toEqual([true, true, true]);
  expect(location.hash).toBe("#three.3");
});

test("a number declared by hand still wins", async () => {
  const Padded = slide({ path: "padded", steps: 6 }, () =>
    jsx("div", { children: jsx(Step, { children: "a" }) }),
  );

  const { deck } = await mount([Padded, Plain]);
  for (let i = 0; i < 5; i++) deck.move(1);
  expect(deck.at.index).toBe(0);

  deck.move(1);
  expect(deck.at.index).toBe(1);
});

test("a transition the browser refuses still changes the slide", async () => {
  const { deck, host } = await mount([Three, Plain]);
  const refused = () => Promise.reject(new DOMException("aborted", "InvalidStateError"));
  Object.assign(document, {
    startViewTransition: () => ({
      ready: refused(),
      finished: refused(),
      updateCallbackDone: refused(),
      skipTransition() {},
    }),
  });

  try {
    deck.go({ index: 1, step: 0 });
    await tick();

    expect(host.textContent).toContain("nothing to reveal");
    expect(location.hash).toBe("#plain");
  } finally {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});
