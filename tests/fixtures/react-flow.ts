import { vi } from "vitest";

// jsdom には無い、React Flow が使うブラウザの部品を、テストのときだけ置く。
// ノードの大きさは測れないので、決まった大きさを返す。
export function installReactFlowStubs(): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.callback(
          [{ target } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22: number;
      constructor(transform?: string) {
        const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
        this.m22 = scale === undefined ? 1 : Number(scale);
      }
    },
  );
  // 線の名前の大きさを測る（SVG の要素）。
  Object.defineProperty(window.SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 40, height: 12 }),
  });
  Object.defineProperties(window.HTMLElement.prototype, {
    offsetHeight: { configurable: true, get: () => 100 },
    offsetWidth: { configurable: true, get: () => 120 },
  });
}
