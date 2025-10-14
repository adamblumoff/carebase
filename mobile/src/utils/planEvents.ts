type PlanEventListener = () => void;

const listeners = new Set<PlanEventListener>();

export function emitPlanChanged(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('Plan event listener failed', error);
    }
  });
}

export function addPlanChangeListener(listener: PlanEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
