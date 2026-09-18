import {
  dispose,
  flushSync,
  render,
  type Child,
  type ComponentContext,
  type ComponentObject,
  type VNode,
} from "./dom.ts";
import { advance, parseHash, formatHash, LAST, type Pos, type Paths } from "./nav.ts";

export type SlideMeta = {
  /** How many stops this slide has. Omit it to derive the count from <Step>. */
  steps?: number;
  /** The name that shows in the URL. Omit it and the index is used. */
  path?: string;
  /** What you want to be reminded of while this slide is up. */
  notes?: string;
};

export type SlideComponent<S = {}> = ComponentObject<{}, S> & SlideMeta;

/**
 * The common case: immutable slide metadata plus a function that returns JSX.
 * The result is a plain object; no class or constructor is involved.
 */
export function slide(meta: SlideMeta, view: () => Child): SlideComponent {
  return defineSlide(meta, { view });
}

/**
 * The lower-level object form for a slide that needs state or lifecycle.
 * Still a plain object: the runtime creates the per-mount instance record.
 */
export function defineSlide<S = {}>(
  meta: SlideMeta,
  definition: Omit<ComponentObject<{}, S>, "enter">,
): SlideComponent<S> {
  return {
    ...definition,
    ...meta,
    enter() {
      scope.counted = 0;
    },
  };
}

/** Where the deck is. */
export type At = {
  index: number;
  step: number;
  steps: number;
  total: number;
  path: string;
};

export type SlideInfo = {
  path: string;
  notes?: string;
};

export type DeckContext = {
  readonly at: At;
  readonly slides: readonly SlideInfo[];
  go(to: string | { index: number; step?: number }): void;
  move(by: 1 | -1): void;
  on(event: "move", run: (at: At) => void): () => void;
  /** Unmount the deck and release its listeners/plugins. */
  destroy(): void;
};

export type Plugin = (deck: DeckContext) => (() => void) | void;

const BACK_ZONE = 0.25;

let scope = { step: 0, counted: 0 };

function position(n: number | [number, number] | undefined): [enter: number, until: number] {
  if (n === undefined) return [++scope.counted, Infinity];
  const [enter, until = Infinity] = Array.isArray(n) ? n : [n];
  scope.counted = Math.max(scope.counted, Number.isFinite(until) ? until - 1 : enter);
  return [enter, until];
}

const classes = (...parts: unknown[]) => parts.filter(Boolean).join(" ");

function markable(children: Child): VNode | undefined {
  const real = (Array.isArray(children) ? children : [children]).filter(
    (c) => !(c == null || typeof c === "boolean" || (typeof c === "string" && !c.trim())),
  );
  const only = real.length === 1 ? real[0] : undefined;
  return only && typeof only === "object" && !Array.isArray(only) && typeof only.type === "string"
    ? only
    : undefined;
}

export function Step({
  n,
  class: cls,
  children,
  ...rest
}: {
  n?: number | [number, number];
  class?: string;
  children?: Child;
  [attr: string]: unknown;
}): Child {
  const [enter, until] = position(n);
  const mark = {
    "data-n": enter,
    "data-until": Number.isFinite(until) ? until : null,
    "data-shown": (enter <= scope.step && scope.step < until) || null,
    ...rest,
  };
  const target = markable(children);

  if (target) {
    return {
      ...target,
      props: { ...target.props, ...mark, class: classes(target.props.class, "step", cls) },
    };
  }

  return (
    <div class={classes("step", cls)} {...mark}>
      {children}
    </div>
  );
}

function syncSteps(root: ParentNode, step: number) {
  scope.step = step;
  for (const el of root.querySelectorAll<HTMLElement>(".step[data-n]")) {
    const until = el.dataset.until ? Number(el.dataset.until) : Infinity;
    el.toggleAttribute("data-shown", Number(el.dataset.n) <= step && step < until);
  }
}

function SlideAt({ slide: current, step }: { slide: SlideComponent; step: number }) {
  scope = { step, counted: 0 };
  const Current = current;
  return <Current />;
}

type DeckProps = { slides: SlideComponent[]; width?: number; height?: number };

type DeckState = {
  i: number;
  paths: Paths;
  measured: number[];
  pos: Pos;
  listeners: Set<(at: At) => void>;
  teardown: (() => void)[];
};

type DeckRuntime = ComponentContext<DeckProps, DeckState>;

const stage = (ctx: DeckRuntime): ParentNode => {
  const root = ctx.el as Element;
  return root.querySelector(".stage") ?? root;
};

const steps = (ctx: DeckRuntime, i: number) =>
  ctx.props.slides[i]?.steps ?? ctx.state.measured[i] ?? 1;

function measure(ctx: DeckRuntime) {
  const marks = [...stage(ctx).querySelectorAll<HTMLElement>(".step[data-n]")];
  const highest = Math.max(
    0,
    ...marks.flatMap((el) => [Number(el.dataset.n), Number(el.dataset.until ?? 0)]),
  );
  ctx.state.measured[ctx.state.pos[0]] = highest + 1;
}

function snapshot(ctx: DeckRuntime, [i, step]: Pos = ctx.state.pos): At {
  return {
    index: i,
    step,
    steps: steps(ctx, i),
    total: ctx.props.slides.length,
    path: formatHash([i, step], ctx.state.paths),
  };
}

function announce(ctx: DeckRuntime, next: Pos) {
  const at = snapshot(ctx, next);
  for (const run of [...ctx.state.listeners]) run(at);
}

function settle(ctx: DeckRuntime) {
  measure(ctx);
  const [i, step] = ctx.state.pos;
  ctx.state.pos = [i, Math.min(step, steps(ctx, i) - 1)];
  syncSteps(stage(ctx), ctx.state.pos[1]);

  const hash = formatHash(ctx.state.pos, ctx.state.paths);
  if (location.hash !== hash) history.replaceState(null, "", hash);
  announce(ctx, ctx.state.pos);
}

function go(ctx: DeckRuntime, next: Pos) {
  const slideChanged = next[0] !== ctx.state.pos[0];
  const dir = next[0] > ctx.state.pos[0] ? "forward" : "back";
  ctx.state.pos = next;

  if (!slideChanged) {
    settle(ctx);
    return;
  }

  const swap = () => {
    ctx.setState({ i: next[0] });
    flushSync();
    settle(ctx);
  };

  document.documentElement.dataset.suraidoDir = dir;

  let swapped = false;
  const once = () => {
    if (swapped) return;
    swapped = true;
    swap();
  };

  if (!document.startViewTransition) {
    once();
    return;
  }

  const shift = document.startViewTransition(once);
  shift.ready.catch(() => {});
  shift.finished.catch(() => {});
  shift.updateCallbackDone.catch(once);
}

function move(ctx: DeckRuntime, dir: 1 | -1) {
  go(ctx, advance(ctx.state.pos, dir, (i) => steps(ctx, i), ctx.props.slides.length));
}

export const Deck: ComponentObject<DeckProps, DeckState> = {
  state(props) {
    const paths = props.slides.map((s) => s.path);
    const pos = parseHash(location.hash, paths);
    return {
      i: pos[0],
      paths,
      measured: [],
      pos,
      listeners: new Set(),
      teardown: [],
    };
  },

  mounted(ctx) {
    const onKey = (e: KeyboardEvent) => {
      const dir = {
        ArrowRight: 1,
        ArrowDown: 1,
        " ": 1,
        PageDown: 1,
        ArrowLeft: -1,
        ArrowUp: -1,
        PageUp: -1,
      }[e.key];

      if (dir) move(ctx, dir as 1 | -1);
      else if (e.key === "Home") go(ctx, [0, 0]);
      else if (e.key === "End") go(ctx, [ctx.props.slides.length - 1, LAST]);
      else if (e.key === "f") {
        void (document.fullscreenElement
          ? document.exitFullscreen()
          : document.body.requestFullscreen());
      } else {
        return;
      }
      e.preventDefault();
    };

    const onHash = () => go(ctx, parseHash(location.hash, ctx.state.paths));
    const fit = () => {
      const { width = 1920, height = 1080 } = ctx.props;
      const scale = Math.min(innerWidth / width, innerHeight / height);
      document.documentElement.style.setProperty("--suraido-scale", String(scale));
    };

    addEventListener("keydown", onKey);
    addEventListener("hashchange", onHash);
    addEventListener("resize", fit);
    fit();
    go(ctx, ctx.state.pos);

    return () => {
      for (const off of ctx.state.teardown.reverse()) off();
      ctx.state.teardown.length = 0;
      ctx.state.listeners.clear();
      removeEventListener("keydown", onKey);
      removeEventListener("hashchange", onHash);
      removeEventListener("resize", fit);
    };
  },

  view(ctx) {
    const { slides, width = 1920, height = 1080 } = ctx.props;
    const Current = slides[ctx.state.i];

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("a, button, input, select, textarea, label, [data-suraido-keep]")) {
        return;
      }
      const back = e.shiftKey || e.clientX < innerWidth * BACK_ZONE;
      move(ctx, back ? -1 : 1);
    };

    return (
      <div class="deck" onClick={onClick}>
        <div class="stage" style={{ width: `${width}px`, height: `${height}px` }}>
          <SlideAt slide={Current} step={ctx.state.pos[1]} />
        </div>
        <div class="pager">{`${ctx.state.i + 1} / ${slides.length}`}</div>
      </div>
    );
  },
};

export type DeckOptions = Omit<DeckProps, "slides"> & {
  use?: Plugin[];
};

export function deck(slides: SlideComponent[], { use = [], ...opts }: DeckOptions = {}) {
  const host =
    document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
  const mounted = render(<Deck slides={slides} {...opts} />, host);
  const self = mounted.comp?.context as DeckRuntime;

  const context: DeckContext = {
    get at() {
      return snapshot(self);
    },
    get slides() {
      return slides.map((item, i) => ({
        path: formatHash([i, 0], self.state.paths),
        notes: item.notes,
      }));
    },
    go(to) {
      go(self, typeof to === "string" ? parseHash(to, self.state.paths) : [to.index, to.step ?? 0]);
    },
    move(by) {
      move(self, by);
    },
    on(_event, run) {
      self.state.listeners.add(run);
      return () => self.state.listeners.delete(run);
    },
    destroy() {
      dispose(mounted);
      host.replaceChildren();
    },
  };

  for (const plugin of use) {
    const off = plugin(context);
    if (off) self.state.teardown.push(off);
  }

  return context;
}
