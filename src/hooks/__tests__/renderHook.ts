import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Enable React 19 `act(...)` mode outside @testing-library/react.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderHookResult<T> {
  result: { current: T };
  unmount: () => void;
}

export function renderHook<T>(useHook: () => T): RenderHookResult<T> {
  const resultRef: { current: T | undefined } = { current: undefined };

  const TestComponent = () => {
    resultRef.current = useHook();
    return null;
  };

  const container = document.createElement("div");
  document.body.appendChild(container);

  const root: Root = createRoot(container);

  act(() => {
    root.render(createElement(TestComponent));
  });

  return {
    result: {
      get current(): T {
        return resultRef.current as T;
      },
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
}