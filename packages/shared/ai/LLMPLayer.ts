// packages/shared/ai/LLMPLayer.ts
import type { BaseGameState, BaseGameAction } from "../GameRules";
import type { IAIPlayer } from "./IAIPlayer";

/**
 * LLMとの通信を担当するサービスインターフェース
 */
export interface LLMService {
  chat(prompt: string): Promise<string>;
}

export interface LLMPlayerOptions {
  name?: string;
  gameDescription?: string;
  maxRetries?: number;
  temperature?: number;
}

/**
 * LLM（Large Language Model）を使用してゲームの指し手を決定するAIプレイヤー。
 * ゲーム状態と合法手を自然言語（プロンプト）に変換してLLMに送り、
 * その回答を解析してアクションを選択する。
 */
export class LLMPlayer<
  TState extends BaseGameState,
  TAction extends BaseGameAction,
> implements IAIPlayer<TState, TAction> {
  public readonly name: string;
  public readonly playerId: string;
  private llmService: LLMService;
  private options: LLMPlayerOptions;

  constructor(playerId: string, llmService: LLMService, options: LLMPlayerOptions = {}) {
    this.playerId = playerId;
    this.llmService = llmService;
    this.name = options.name || "LLMBot";
    this.options = {
      maxRetries: 2,
      temperature: 0,
      ...options,
    };
  }

  public async computeNextMove(state: TState, legalActions: TAction[]): Promise<TAction | null> {
    if (!legalActions || legalActions.length === 0) {
      return null;
    }

    // 1手しかない場合はLLMを呼ぶまでもなく即答
    if (legalActions.length === 1) {
      return { ...legalActions[0], playerId: this.playerId };
    }

    const prompt = this.buildPrompt(state, legalActions);

    let retryCount = 0;
    while (retryCount <= (this.options.maxRetries || 0)) {
      try {
        const response = await this.llmService.chat(prompt);
        const actionIndex = this.parseActionIndex(response, legalActions.length);

        if (actionIndex !== null && actionIndex >= 0 && actionIndex < legalActions.length) {
          return {
            ...legalActions[actionIndex],
            playerId: this.playerId,
          };
        }
      } catch (error) {
        console.error(`LLMPlayer error (retry ${retryCount}):`, error);
      }
      retryCount++;
    }

    // LLMが失敗した、または不正な回答をした場合はフォールバックとして最初の合法手を選択
    console.warn(`LLMPlayer failed to get valid move. Falling back to first legal action.`);
    return {
      ...legalActions[0],
      playerId: this.playerId,
    };
  }

  /**
   * ゲーム状態と合法手からLLMへのプロンプトを構築する
   */
  private buildPrompt(state: TState, legalActions: TAction[]): string {
    const gameDesc = this.options.gameDescription
      ? `Game Description: ${this.options.gameDescription}\n`
      : "";

    let prompt = `You are a professional game player AI. 
${gameDesc}
Current Game State (JSON):
${JSON.stringify(state, null, 2)}

Your Player ID: ${this.playerId}

Legal Actions:
`;

    legalActions.forEach((action, index) => {
      prompt += `${index}: ${JSON.stringify(action)}\n`;
    });

    prompt += `
Instructions:
1. Analyze the current state and determine the best move from the legal actions list.
2. Reply ONLY with the index number of your chosen action.
3. Do not include any explanation or extra text.

Selected Action Index:`;

    return prompt;
  }

  /**
   * LLMの回答からアクションのインデックスを抽出する
   */
  private parseActionIndex(response: string, maxIndex: number): number | null {
    // 応答から最初の数字（整数）を探す
    const match = response.trim().match(/^\d+/);
    if (match) {
      const index = parseInt(match[0], 10);
      if (index >= 0 && index < maxIndex) {
        return index;
      }
    }

    // 数字だけじゃない場合も考慮して、緩めに検索
    const looseMatch = response.match(/\b\d+\b/);
    if (looseMatch) {
      const index = parseInt(looseMatch[0], 10);
      if (index >= 0 && index < maxIndex) {
        return index;
      }
    }

    return null;
  }
}
