export interface UndoState {
  past: string[];
  present: string;
  future: string[];
}

export function createUndoState(initial: string): UndoState {
  return { past: [], present: initial, future: [] };
}

export function pushToHistory(state: UndoState, newContent: string): UndoState {
  if (newContent === state.present) return state;
  return {
    past: [...state.past.slice(-49), state.present],
    present: newContent,
    future: [],
  };
}

export function undo(state: UndoState): UndoState {
  if (state.past.length === 0) return state;
  return {
    past: state.past.slice(0, -1),
    present: state.past[state.past.length - 1],
    future: [state.present, ...state.future],
  };
}

export function redo(state: UndoState): UndoState {
  if (state.future.length === 0) return state;
  return {
    past: [...state.past, state.present],
    present: state.future[0],
    future: state.future.slice(1),
  };
}
