/**
 * A minimal JSX runtime: vnodes into DOM, and plain component objects with per-mount state.
 * There is no diffing. setState rebuilds that subtree outright.
 */

export type VNode = { type: unknown; props: Record<string, any>; key: unknown };
export type Child = VNode | string | number | null | undefined | boolean | Child[];

export const Fragment = Symbol.for("jsx.fragment");
const SVG = "http://www.w3.org/2000/svg";

type Source = { subscribe(run: () => void): () => void };

export type ComponentContext<P = {}, S = {}> = {
  readonly props: P;
  readonly state: S;
  /** The root DOM node built by this component. Valid once it has mounted. */
  readonly el: Node;
  setState(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  /** Redraw whenever any source changes; subscriptions are dropped on unmount. */
  watch(...sources: Source[]): void;
};

export type ComponentObject<P = {}, S = {}> = {
  /** Fresh state for each mount. Omit it for a stateless component. */
  state?: (props: P) => S;
  view(context: ComponentContext<P, S>): Child;
  mounted?(context: ComponentContext<P, S>): void | (() => void);
  updated?(context: ComponentContext<P, S>): void;
  unmounted?(context: ComponentContext<P, S>): void;
  /** @internal Runs just before this component's subtree is rebuilt. */
  enter?(context: ComponentContext<P, S>): void;
};

/** What was built, and which component object built it. */
export type Inst = { dom?: Node; comp?: ComponentInstance<any, any>; kids: Inst[] };

export type ComponentInstance<P = {}, S = {}> = {
  definition: ComponentObject<P, S>;
  props: P;
  state: S;
  context: ComponentContext<P, S>;
  inst: Inst;
  ns: string | null;
  dead: boolean;
  unwatch: (() => void)[];
  cleanup?: () => void;
};

const domOf = (i: Inst): Node => i.dom ?? domOf(i.kids[0]);

/**
 * Flattens children into one list. Falsy children stay as empty text, so when
 * `{cond && <p/>}` disappears the siblings after it keep their index.
 */
function flatten(c: Child, out: (VNode | string)[] = []): (VNode | string)[] {
  if (Array.isArray(c)) {
    for (const x of c) flatten(x, out);
  } else if (c == null || typeof c === "boolean") {
    out.push("");
  } else if (typeof c === "object") {
    if (c.type === Fragment) flatten(c.props.children, out);
    else out.push(c);
  } else {
    out.push(String(c));
  }
  return out;
}

/** A component's return value is treated as a single root. */
const one = (c: Child) => flatten(c)[0] ?? "";

const isComponentObject = (value: unknown): value is ComponentObject<any, any> =>
  typeof value === "object" && value !== null && typeof (value as any).view === "function";

const dirty = new Set<ComponentInstance<any, any>>();

function schedule(instance: ComponentInstance<any, any>) {
  if (dirty.size === 0) queueMicrotask(flush);
  dirty.add(instance);
}

function createComponent<P, S>(
  definition: ComponentObject<P, S>,
  props: P,
  ns: string | null,
): ComponentInstance<P, S> {
  const instance: ComponentInstance<P, S> = {
    definition,
    props,
    state: definition.state?.(props) ?? ({} as S),
    context: undefined as unknown as ComponentContext<P, S>,
    inst: undefined as unknown as Inst,
    ns,
    dead: false,
    unwatch: [],
  };

  instance.context = {
    get props() {
      return instance.props;
    },
    get state() {
      return instance.state;
    },
    get el() {
      return domOf(instance.inst);
    },
    setState(patch) {
      instance.state = {
        ...instance.state,
        ...(typeof patch === "function" ? patch(instance.state) : patch),
      };
      schedule(instance);
    },
    watch(...sources) {
      for (const source of sources) {
        instance.unwatch.push(source.subscribe(() => schedule(instance)));
      }
    },
  };

  return instance;
}

function mount(v: VNode | string, ns: string | null): Inst {
  if (typeof v === "string") return { dom: document.createTextNode(v), kids: [] };

  const { type, props } = v;
  if (isComponentObject(type)) {
    const comp = createComponent(type, props, ns);
    const inst: Inst = { comp, kids: [] };
    comp.inst = inst;
    inst.kids = [mount(one(type.view(comp.context)), ns)];
    queueMicrotask(() => {
      if (comp.dead) return;
      comp.cleanup = type.mounted?.(comp.context) || undefined;
    });
    return inst;
  }

  if (typeof type === "function") {
    const inst: Inst = { kids: [] };
    inst.kids = [mount(one((type as (p: any) => Child)(props)), ns)];
    return inst;
  }

  const childNs = type === "svg" ? SVG : ns;
  const el = childNs
    ? document.createElementNS(childNs, type as string)
    : document.createElement(type as string);
  const inst: Inst = { dom: el, kids: [] };
  applyProps(el, props);
  for (const c of flatten(props.children)) {
    const k = mount(c, childNs);
    el.appendChild(domOf(k));
    inst.kids.push(k);
  }
  return inst;
}

function unmount(inst: Inst) {
  if (inst.comp) {
    const comp = inst.comp;
    comp.dead = true;
    for (const off of comp.unwatch) off();
    comp.unwatch.length = 0;
    comp.cleanup?.();
    comp.cleanup = undefined;
    comp.definition.unmounted?.(comp.context);
  }
  for (const k of inst.kids) unmount(k);
}

function applyProps(el: Element, props: Record<string, any>) {
  for (const k in props) if (k !== "children") setProp(el, k, props[k]);
}

/** Props go straight to DOM attributes. Only on* is routed to addEventListener. */
function setProp(el: any, k: string, v: unknown) {
  if (k.startsWith("on")) {
    if (v) el.addEventListener(k.slice(2).toLowerCase(), v);
  } else if (k === "style") {
    el.style.cssText = "";
    if (v && typeof v === "object") Object.assign(el.style, v);
    else if (typeof v === "string") el.style.cssText = v;
  } else if (k === "value" || k === "checked") {
    el[k] = v ?? "";
  } else if (v === true) {
    el.setAttribute(k, "");
  } else if (typeof v === "string" || typeof v === "number") {
    el.setAttribute(k, String(v));
  } else {
    el.removeAttribute(k);
  }
}

function flush() {
  const pending = [...dirty];
  dirty.clear();

  for (const comp of pending) {
    if (comp.dead) continue;

    const prev = comp.inst.kids[0];
    comp.definition.enter?.(comp.context);
    const fresh = mount(one(comp.definition.view(comp.context)), comp.ns);
    const gone = domOf(prev);
    gone.parentNode!.replaceChild(domOf(fresh), gone);
    unmount(prev);
    comp.inst.kids = [fresh];
    comp.definition.updated?.(comp.context);
  }
}

/**
 * Flushes pending re-renders synchronously.
 * For callers like View Transitions that demand the DOM change finish right here.
 */
export function flushSync() {
  flush();
}

export function render(v: Child, container: Element) {
  const inst = mount(one(v), null);
  container.replaceChildren(domOf(inst));
  return inst;
}

/** Runs lifecycle cleanup for a mounted tree. */
export function dispose(inst: Inst) {
  unmount(inst);
}
