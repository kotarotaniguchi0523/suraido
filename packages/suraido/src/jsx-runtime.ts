import type { Child, ComponentObject, VNode } from "./dom.ts";
export { Fragment } from "./dom.ts";

export const jsx = (type: unknown, props: Record<string, any>, key: unknown = null): VNode => ({
  type,
  props,
  key,
});
export const jsxs = jsx;
export const jsxDEV = jsx;

type Attrs = { [K in `on${string}`]?: (e: any) => void } & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  children?: Child;
  [attr: string]: unknown;
};

export namespace JSX {
  export type Element = VNode;
  export type ElementType = string | ((props: any) => Child) | ComponentObject<any, any>;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export interface IntrinsicElements {
    [tag: string]: Attrs;
  }
}
