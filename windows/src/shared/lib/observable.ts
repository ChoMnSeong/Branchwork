import { useSyncExternalStore } from "react";

/** 바뀌면 구독자에게 알리는 상태 객체. 같은 틱의 여러 변경은 한 번에 알린다. */
export class Observable {
  private listeners = new Set<() => void>();
  private version = 0;
  private scheduled = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  protected emit() {
    this.version++;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.listeners.forEach((l) => l());
    });
  }
}

/** 컴포넌트가 객체의 변경을 따라 다시 그려지게 한다 */
export function useObserve<T extends Observable>(o: T): T {
  useSyncExternalStore(o.subscribe, o.getVersion);
  return o;
}
