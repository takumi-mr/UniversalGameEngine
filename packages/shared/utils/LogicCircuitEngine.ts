export type LogicBlockType =
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
  | "D_FLIP_FLOP"
  | "ROM"
  | "RAM"
  | string;

export interface SubCircuit {
  blocks: Record<string, LogicBlock>;
  connections: Connection[];
}

export interface LogicBlock {
  id: string;
  type: LogicBlockType;
  x?: number;
  y?: number;
  outputs: number[]; // Array of output values (0 or 1)

  // Internal state for specific gates
  lastClock?: number; // For flip-flops and RAM
  memory?: number[]; // For RAM data
  romData?: number[]; // For ROM instructions
  compound?: SubCircuit; // For nested circuits
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
      case "ROM": {
        const addr =
          (inputs[0] || 0) + (inputs[1] || 0) * 2 + (inputs[2] || 0) * 4 + (inputs[3] || 0) * 8;
        const val = block.romData ? block.romData[addr] || 0 : 0;
        const results: number[] = [];
        for (let i = 0; i < 8; i++) {
          results.push((val >> i) & 1);
        }
        return results;
      }
      case "RAM": {
        const addr =
          (inputs[0] || 0) + (inputs[1] || 0) * 2 + (inputs[2] || 0) * 4 + (inputs[3] || 0) * 8;
        const dataIn =
          (inputs[4] || 0) + (inputs[5] || 0) * 2 + (inputs[6] || 0) * 4 + (inputs[7] || 0) * 8;
        const we = inputs[8] || 0;
        const clk = inputs[9] || 0;
        const prevClk = block.lastClock || 0;
        block.lastClock = clk;

        if (!block.memory) block.memory = new Array(16).fill(0);

        if (clk === 1 && prevClk === 0 && we === 1) {
          block.memory[addr] = dataIn;
        }

        const val = block.memory[addr] || 0;
        const results: number[] = [];
        for (let i = 0; i < 4; i++) {
          results.push((val >> i) & 1);
        }
        return results;
      }
      default:
        return block.outputs || [0];
    }
  }
}
