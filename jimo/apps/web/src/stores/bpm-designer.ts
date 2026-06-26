import { create } from 'zustand';
import type { LfGraphData, LfNode, LfEdge, LfNodeProperties, LfEdgeProperties } from '@/services/bpm';

// ===================== State Types =====================

export interface BpmDesignerState {
  // --- Graph state ---
  /** The current LogicFlow graph data (nodes + edges). */
  lfJson: LfGraphData | null;
  /** Currently selected node id in the designer canvas. */
  selectedNodeId: string | null;

  // --- Editor state ---
  /** Whether the graph has unsaved changes. */
  isDirty: boolean;
  /** Whether a save operation is in progress. */
  isSaving: boolean;
  /** ISO timestamp of the last successful save. */
  lastSavedAt: string | null;

  // --- Toolbar state ---
  /** Current canvas zoom level (1 = 100%). */
  zoom: number;
  /** Stack of previous graph states for undo. */
  undoStack: LfGraphData[];
  /** Stack of future graph states for redo (cleared on new mutation). */
  redoStack: LfGraphData[];

  // --- Definition context ---
  /** ID of the currently loaded process definition. */
  definitionId: string | null;
  /** Name of the currently loaded process definition. */
  processName: string;
  /** Key of the currently loaded process definition. */
  processKey: string;

  // --- Panel state ---
  /** Currently active side panel tab. */
  activeTab: string;
}

// ===================== Actions Type =====================

export interface BpmDesignerActions {
  /** Replace the entire graph with a new one. Clears undo/redo stacks. */
  setLfJson: (graph: LfGraphData | null) => void;

  /** Update properties of a node by id. Pushes current state to undo stack. */
  updateNode: (nodeId: string, props: Partial<LfNodeProperties>) => void;

  /** Update properties of an edge by id. Pushes current state to undo stack. */
  updateEdge: (edgeId: string, props: Partial<LfEdgeProperties>) => void;

  /** Add a node to the graph. Pushes current state to undo stack. */
  addNode: (node: LfNode) => void;

  /** Remove a node (and its connected edges) from the graph. Pushes current state to undo stack. */
  removeNode: (nodeId: string) => void;

  /** Add an edge to the graph. Pushes current state to undo stack. */
  addEdge: (edge: LfEdge) => void;

  /** Remove an edge from the graph. Pushes current state to undo stack. */
  removeEdge: (edgeId: string) => void;

  /** Set the currently selected node id. */
  selectNode: (nodeId: string | null) => void;

  /** Undo last graph mutation. */
  undo: () => void;

  /** Redo last undone graph mutation. */
  redo: () => void;

  /** Clear the dirty flag and update lastSavedAt to now. */
  markClean: () => void;

  /** Set the saving state flag. */
  setSaving: (saving: boolean) => void;

  /** Set the canvas zoom level. */
  setZoom: (zoom: number) => void;

  /** Load a process definition into the designer context. */
  loadDefinition: (def: { id: string; name: string; key: string; lfJson?: LfGraphData | null }) => void;

  /** Set the active side panel tab. */
  setActiveTab: (tab: string) => void;

  /** Reset the store to initial state. */
  reset: () => void;
}

// ===================== Initial State =====================

function getInitialState(): BpmDesignerState {
  return {
    lfJson: null,
    selectedNodeId: null,
    isDirty: false,
    isSaving: false,
    lastSavedAt: null,
    zoom: 1,
    undoStack: [],
    redoStack: [],
    definitionId: null,
    processName: '',
    processKey: '',
    activeTab: 'properties',
  };
}

// ===================== Helpers =====================

function cloneGraph(graph: LfGraphData): LfGraphData {
  return {
    nodes: graph.nodes.map((n) => ({ ...n, properties: { ...n.properties } })),
    edges: graph.edges.map((e) => ({ ...e, properties: { ...e.properties } })),
  };
}

function pushUndo(state: BpmDesignerState): BpmDesignerState {
  if (!state.lfJson) return state;
  const snapshot = cloneGraph(state.lfJson);
  // Limit undo stack to 50 entries to prevent memory leaks
  const undoStack = [...state.undoStack, snapshot].slice(-50);
  return { ...state, undoStack, redoStack: [], isDirty: true };
}

// ===================== Store =====================

export const useBpmDesignerStore = create<BpmDesignerState & BpmDesignerActions>()(
  (set, get) => ({
    ...getInitialState(),

    // --- Graph ---

    setLfJson: (graph) => {
      set({
        lfJson: graph ? cloneGraph(graph) : null,
        undoStack: [],
        redoStack: [],
        isDirty: false,
        selectedNodeId: null,
      });
    },

    // --- Node mutations ---

    updateNode: (nodeId, props) => {
      const state = get();
      if (!state.lfJson) return;
      const next = pushUndo(state);
      const nodes = next.lfJson!.nodes.map((n) =>
        n.id === nodeId ? { ...n, properties: { ...n.properties, ...props } } : n,
      );
      set({ ...next, lfJson: { ...next.lfJson!, nodes } });
    },

    addNode: (node) => {
      const state = get();
      if (!state.lfJson) {
        set({
          lfJson: { nodes: [node], edges: [] },
          isDirty: true,
        });
        return;
      }
      const next = pushUndo(state);
      const nodes = [...next.lfJson!.nodes, node];
      set({ ...next, lfJson: { ...next.lfJson!, nodes } });
    },

    removeNode: (nodeId) => {
      const state = get();
      if (!state.lfJson) return;
      const next = pushUndo(state);
      const nodes = next.lfJson!.nodes.filter((n) => n.id !== nodeId);
      const edges = next.lfJson!.edges.filter(
        (e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId,
      );
      set({
        ...next,
        lfJson: { nodes, edges },
        selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      });
    },

    // --- Edge mutations ---

    updateEdge: (edgeId, props) => {
      const state = get();
      if (!state.lfJson) return;
      const next = pushUndo(state);
      const edges = next.lfJson!.edges.map((e) =>
        e.id === edgeId ? { ...e, properties: { ...e.properties, ...props } } : e,
      );
      set({ ...next, lfJson: { ...next.lfJson!, edges } });
    },

    addEdge: (edge) => {
      const state = get();
      if (!state.lfJson) return;
      const next = pushUndo(state);
      const edges = [...next.lfJson!.edges, edge];
      set({ ...next, lfJson: { ...next.lfJson!, edges } });
    },

    removeEdge: (edgeId) => {
      const state = get();
      if (!state.lfJson) return;
      const next = pushUndo(state);
      const edges = next.lfJson!.edges.filter((e) => e.id !== edgeId);
      set({ ...next, lfJson: { ...next.lfJson!, edges } });
    },

    // --- Selection ---

    selectNode: (nodeId) => {
      set({ selectedNodeId: nodeId });
    },

    // --- Undo / Redo ---

    undo: () => {
      const { lfJson, undoStack, redoStack } = get();
      if (!undoStack.length) return;
      const prev = undoStack.length - 1;
      const restored = cloneGraph(undoStack[prev]);
      const newUndo = undoStack.slice(0, prev);
      const newRedo = lfJson ? [cloneGraph(lfJson), ...redoStack] : redoStack;
      set({
        lfJson: restored,
        undoStack: newUndo,
        redoStack: newRedo,
        isDirty: true,
      });
    },

    redo: () => {
      const { lfJson, undoStack, redoStack } = get();
      if (!redoStack.length) return;
      const restored = cloneGraph(redoStack[0]);
      const newRedo = redoStack.slice(1);
      const newUndo = lfJson ? [...undoStack, cloneGraph(lfJson)] : undoStack;
      set({
        lfJson: restored,
        undoStack: newUndo,
        redoStack: newRedo,
        isDirty: true,
      });
    },

    // --- Save state ---

    markClean: () => {
      set({
        isDirty: false,
        lastSavedAt: new Date().toISOString(),
      });
    },

    setSaving: (saving) => {
      set({ isSaving: saving });
    },

    // --- Toolbar ---

    setZoom: (zoom) => {
      set({ zoom: Math.max(0.1, Math.min(3, zoom)) });
    },

    // --- Definition context ---

    loadDefinition: (def) => {
      set({
        definitionId: def.id,
        processName: def.name,
        processKey: def.key,
        lfJson: def.lfJson ? cloneGraph(def.lfJson) : null,
        undoStack: [],
        redoStack: [],
        isDirty: false,
        lastSavedAt: null,
        selectedNodeId: null,
      });
    },

    // --- Panel ---

    setActiveTab: (tab) => {
      set({ activeTab: tab });
    },

    // --- Reset ---

    reset: () => {
      set(getInitialState());
    },
  }),
);
