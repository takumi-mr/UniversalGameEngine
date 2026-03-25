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

export interface SubCircuit {
  blocks: Record<string, LogicBlock>;
  connections: Connection[];
}

export interface LogicBlock {
  id: string;
  type: GateType | string;
  x?: number; // Visual position
  y?: number; // Visual position
  outputs: number[]; // Array of current output states
  lastClock?: number; // For edge-triggered components
  state?: any; // For sequential logic internal state
  compound?: SubCircuit; // Internal circuit for custom blocks
}

export interface Connection {
  fromBlockId: string;
  fromPinIndex: number;
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

    // Initialize outputs if missing
    for (const blockId in blocks) {
      if (!blocks[blockId].outputs) {
        blocks[blockId].outputs = [0];
      }
    }

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      // Compute next state for each block
      const nextOutputs: Record<string, number[]> = {};

      for (const blockId in blocks) {
        const block = blocks[blockId];
        const incomingConnections = connections.filter((c) => c.toBlockId === blockId);

        // Find maximum pin index to size the inputs array
        const maxPin = incomingConnections.reduce((max, c) => Math.max(max, c.toPinIndex), -1);
        const inputValues = new Array(maxPin + 1).fill(0);

        for (const conn of incomingConnections) {
          const fromBlock = blocks[conn.fromBlockId];
          if (fromBlock && fromBlock.outputs) {
            inputValues[conn.toPinIndex] = fromBlock.outputs[conn.fromPinIndex] || 0;
          }
        }

        const nextBlockOutputs = this.computeGateOutput(block, inputValues);

        // Check if outputs changed
        if (
          !block.outputs ||
          nextBlockOutputs.length !== block.outputs.length ||
          nextBlockOutputs.some((v, i) => v !== block.outputs[i])
        ) {
          nextOutputs[blockId] = nextBlockOutputs;
          changed = true;
        }
      }

      // Apply changes
      for (const blockId in nextOutputs) {
        blocks[blockId].outputs = nextOutputs[blockId];
      }
    }

    return iterations < maxIterations;
  }

  private static computeGateOutput(block: LogicBlock, inputs: number[]): number[] {
    if (block.compound) {
      const subBlocks = block.compound.blocks;
      const subConns = block.compound.connections;

      // Update sub-circuit inputs (mapping: in1, in2, ...)
      for (let i = 0; i < inputs.length; i++) {
        const inId = `in${i + 1}`;
        if (subBlocks[inId]) {
          subBlocks[inId].outputs = [inputs[i]];
        }
      }

      this.simulate(subBlocks, subConns);

      // Collect outputs from sub-circuit (mapping: out1, out2, ...)
      const results: number[] = [];
      let i = 1;
      while (subBlocks[`out${i}`]) {
        results.push(subBlocks[`out${i}`].outputs[0] || 0);
        i++;
      }
      return results;
    }

    switch (block.type) {
      case "AND":
        return [inputs.length >= 2 && inputs.every((v) => v === 1) ? 1 : 0];
      case "OR":
        return [inputs.some((v) => v === 1) ? 1 : 0];
      case "NOT":
        return [inputs[0] === 1 ? 0 : 1];
      case "NAND":
        return [inputs.length >= 2 && inputs.every((v) => v === 1) ? 0 : 1];
      case "NOR":
        return [inputs.some((v) => v === 1) ? 0 : 1];
      case "XOR":
        return [inputs.filter((v) => v === 1).length % 2 === 1 ? 1 : 0];
      case "XNOR":
        return [inputs.filter((v) => v === 1).length % 2 === 0 ? 1 : 0];
      case "BUFFER":
      case "LED":
        return [inputs[0] || 0];
      case "SWITCH":
      case "CLOCK":
        return block.outputs || [0];
      case "D_FLIP_FLOP": {
        const D = inputs[0] || 0;
        const clk = inputs[1] || 0;
        const prevClk = block.lastClock || 0;
        block.lastClock = clk;
        if (clk === 1 && prevClk === 0) {
          return [D];
        }
        return block.outputs || [0];
      }
      default:
        return block.outputs || [0];
    }
  }
}
