// Original file: network/game.proto

export interface GameMetadata {
  playerCount?: number;
  spectatorCount?: number;
  activePlayers?: string[];
}

export interface GameMetadata__Output {
  playerCount: number;
  spectatorCount: number;
  activePlayers: string[];
}
