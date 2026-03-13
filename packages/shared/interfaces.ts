// src/core/interfaces.ts

export type PlayerColor = 1 | -1; // 1: 黒, -1: 白
export type GameStatus = 'PLAYING' | 'FINISHED';

export interface Position {
    x: number;
    y: number;
    z: number;
}

export interface GameState {
    board: number[][][];
    currentTurn: PlayerColor;
    scores: Record<number, number>;
    validMoves: Position[];
    status: GameStatus;
    message: string;
}

export interface MoveAction extends Position {
    type: 'MOVE';
    color: PlayerColor;
}