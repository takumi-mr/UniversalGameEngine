// src/core/Othello3DCore.ts
import type { GameState, PlayerColor, Position, GameStatus } from './interfaces';

export class Othello3DCore {
    public size: number;
    public readonly EMPTY = 0;
    public readonly BLACK: PlayerColor = 1;
    public readonly WHITE: PlayerColor = -1;

    private board!: number[][][];
    public currentTurn!: PlayerColor;
    private scores!: Record<number, number>;
    private status!: GameStatus;
    private message!: string;
    private validMoves!: Position[];

    constructor(size: number = 4) {
        this.size = size;
        this.reset();
    }

    public reset(): void {
        this.board = Array.from({ length: this.size }, () =>
            Array.from({ length: this.size }, () => Array(this.size).fill(this.EMPTY))
        );
        this.currentTurn = this.BLACK;
        this.scores = { [this.BLACK]: 0, [this.WHITE]: 0 };
        this.status = 'PLAYING';
        this.message = '';

        const m = Math.floor(this.size / 2);
        for (let dz = -1; dz <= 0; dz++) {
            for (let dy = -1; dy <= 0; dy++) {
                for (let dx = -1; dx <= 0; dx++) {
                    const color = (dx + dy + dz) % 2 === 0 ? this.BLACK : this.WHITE;
                    this.board[m + dz][m + dy][m + dx] = color;
                    this.scores[color]++;
                }
            }
        }
        this.validMoves = this.calculateAllValidMoves(this.currentTurn);
    }

    public getState(): GameState {
        return {
            board: this.board,
            currentTurn: this.currentTurn,
            scores: { ...this.scores },
            validMoves: [...this.validMoves],
            status: this.status,
            message: this.message
        };
    }

    private calculateAllValidMoves(color: PlayerColor): Position[] {
        const moves: Position[] = [];
        for (let z = 0; z < this.size; z++) {
            for (let y = 0; y < this.size; y++) {
                for (let x = 0; x < this.size; x++) {
                    if (this.isValidMove(x, y, z, color)) {
                        moves.push({ x, y, z });
                    }
                }
            }
        }
        return moves;
    }

    private isValidMove(x: number, y: number, z: number, color: PlayerColor): boolean {
        if (this.board[z][y][x] !== this.EMPTY) return false;
        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    if (this.countFlips(x, y, z, dx, dy, dz, color) > 0) return true;
                }
            }
        }
        return false;
    }

    private countFlips(x: number, y: number, z: number, dx: number, dy: number, dz: number, color: PlayerColor): number {
        let count = 0;
        let cx = x + dx, cy = y + dy, cz = z + dz;
        while (cx >= 0 && cx < this.size && cy >= 0 && cy < this.size && cz >= 0 && cz < this.size) {
            if (this.board[cz][cy][cx] === this.EMPTY) return 0;
            if (this.board[cz][cy][cx] === color) return count;
            count++;
            cx += dx; cy += dy; cz += dz;
        }
        return 0;
    }

    public dispatchMove(x: number, y: number, z: number, color: PlayerColor): boolean {
        if (this.status !== 'PLAYING') return false;
        if (color !== this.currentTurn) return false;
        if (!this.isValidMove(x, y, z, color)) return false;

        this.message = '';
        this.board[z][y][x] = color;
        this.scores[color]++;

        for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    const flips = this.countFlips(x, y, z, dx, dy, dz, color);
                    for (let i = 1; i <= flips; i++) {
                        const fx = x + dx * i, fy = y + dy * i, fz = z + dz * i;
                        this.board[fz][fy][fx] = color;
                        this.scores[color]++;
                        this.scores[color === this.BLACK ? this.WHITE : this.BLACK]--;
                    }
                }
            }
        }

        this.updateGameState();
        return true;
    }

    private updateGameState(): void {
        const nextTurnColor = this.currentTurn === this.BLACK ? this.WHITE : this.BLACK;
        const nextValidMoves = this.calculateAllValidMoves(nextTurnColor);

        if (nextValidMoves.length > 0) {
            this.currentTurn = nextTurnColor;
            this.validMoves = nextValidMoves;
        } else {
            const currentValidMoves = this.calculateAllValidMoves(this.currentTurn);
            
            if (currentValidMoves.length > 0) {
                const passedColor = nextTurnColor === this.BLACK ? "Black" : "White";
                this.message = `${passedColor} passed!`;
                this.validMoves = currentValidMoves;
            } else {
                this.status = 'FINISHED';
                this.validMoves = [];
                const b = this.scores[this.BLACK];
                const w = this.scores[this.WHITE];
                if (b > w) this.message = "Game Over: Black Wins!";
                else if (w > b) this.message = "Game Over: White Wins!";
                else this.message = "Game Over: Draw!";
            }
        }
    }
}