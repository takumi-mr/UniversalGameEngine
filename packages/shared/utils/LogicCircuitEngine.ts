export type GateType =
  | "AND"
  | "OR"
  | "NOT"
  | "NAND"
  | "NOR"
  | "XOR"
  | "XNOR"
  | "BUFFER"
  | "SWITCH"
  | "LED"
  | "CLOCK"
  | "D_FLIP_FLOP"
  | "T_FLIP_FLOP"
  | "RS_LATCH";

export interface LogicBlock {
  id: string;
  type: GateType;
  x?: number; // Visual position
  y?: number; // Visual position
  inputs: (string | null)[]; // Source block IDs (for simplicity, assumes 1 output per block for now)
  // In a more complex engine, we'd have multiple input/output pins.
  // For now, let's stick to a simpler model: each block has 1 output.
  value: number; // Current output state (0 or 1)
  lastClock?: number; // For edge-triggered components
  state?: any; // For sequential logic internal state
}

export interface Connection {
  fromBlockId: string;
  toBlockId: string;
  toPinIndex: number;
}

export class LogicCircuitEngine {
  /**
   * Propagates signals through the circuit until a stable state is reached.
   * Returns true if stable, false if unstable (e.g., oscillation).
   */
  static simulate(
    blocks: Record<string, LogicBlock>,
    connections: Connection[],
    maxIterations: number = 100,
  ): boolean {
    let changed = true;
    let iterations = 0;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      // Compute next state for each block
      const nextValues: Record<string, number> = {};

      for (const blockId in blocks) {
        const block = blocks[blockId];
        const incomingConnections = connections.filter((c) => c.toBlockId === blockId);
        const inputValues = incomingConnections
          .sort((a, b) => a.toPinIndex - b.toPinIndex)
          .map((c) => blocks[c.fromBlockId].value);

        const nextValue = this.computeGateOutput(block, inputValues);
        if (nextValue !== block.value) {
          nextValues[blockId] = nextValue;
          changed = true;
        }
      }

      // Apply changes
      for (const blockId in nextValues) {
        blocks[blockId].value = nextValues[blockId];
      }
    }

    return iterations < maxIterations;
  }

  private static computeGateOutput(block: LogicBlock, inputs: number[]): number {
    switch (block.type) {
      case "AND":
        return inputs.length >= 2 && inputs.every((v) => v === 1) ? 1 : 0;
      case "OR":
        return inputs.some((v) => v === 1) ? 1 : 0;
      case "NOT":
        return inputs[0] === 1 ? 0 : 1;
      case "NAND":
        return inputs.length >= 2 && inputs.every((v) => v === 1) ? 0 : 1;
      case "NOR":
        return inputs.some((v) => v === 1) ? 0 : 1;
      case "XOR":
        return inputs.filter((v) => v === 1).length % 2 === 1 ? 1 : 0;
      case "XNOR":
        return inputs.filter((v) => v === 1).length % 2 === 0 ? 1 : 0;
      case "BUFFER":
      case "LED":
        return inputs[0] || 0;
      case "SWITCH":
      case "CLOCK":
        return block.value; // Controlled by user/timer
      case "D_FLIP_FLOP": {
        // inputs[0] = D, inputs[1] = Clock
        const D = inputs[0] || 0;
        const clk = inputs[1] || 0;
        const prevClk = block.lastClock || 0;
        block.lastClock = clk;
        if (clk === 1 && prevClk === 0) {
          // Rising edge
          return D;
        }
        return block.value;
      }
      // Add more complex blocks as needed
      default:
        return block.value;
    }
  }
}
