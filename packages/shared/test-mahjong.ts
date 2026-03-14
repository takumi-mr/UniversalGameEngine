// packages/shared/test-mahjong.ts
import { UniversalEngine } from './UniversalEngine';
import { MahjongRuleset, MahjongState, MahjongAction } from './rules/mahjong/MahjongRuleset';

async function testMahjongPriorityAndScoring() {
    console.log("=== Starting Mahjong Priority & Scoring Test ===");
    const engine = new UniversalEngine<MahjongState, MahjongAction>(MahjongRuleset, {
        playerIds: ['p1', 'p2', 'p3', 'p4']
    });

    let state = engine.getState();

    // --- 1. Set up a specific hands for priority testing ---
    // p1 is about to discard '1m'.
    // p2 has [2m, 3m] and wants to CHI '1m'.
    // p3 has [1m, 1m] and wants to PON '1m'.
    // p4 has [11 22 33m 44 55 66p 1s] and wants to RON '1m' (Wait is 1s or 1m, 1m completes Tanyao/Pinfu/Ryanpeikou)

    state.hands['p1'] = ['1m', '9m', '9p', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z', '1m', '2m'].sort();
    state.hands['p2'] = ['2m', '3m', '9p', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z', '8m', '9m'].sort();
    state.hands['p3'] = ['1m', '1m', '9s', '1z', '2z', '3z', '4z', '5z', '6z', '7z', '8m', '9m', '1p'].sort();
    state.hands['p4'] = ['1m', '2m', '2m', '3m', '3m', '4p', '4p', '5p', '5p', '6p', '6p', '1s', '1s'].sort(); // Almost Ryanpeikou, waiting 1m for Ryanpeikou + Tanyao + Pinfu

    // --- 2. Action: p1 discards 1m ---
    console.log("\n--- Dispatching DISCARD 1m by p1 ---");
    engine.dispatch({ type: 'DISCARD', playerId: 'p1', tile: '1m', timestamp: Date.now() });

    state = engine.getState();
    console.log("Pending Discard State:", !!state.pendingDiscard);
    console.log("Active Players (who need to respond):", state.activePlayers);

    // --- 3. Action: Conflict! p2 CHI, p3 PON, p4 RON ---
    console.log("\n--- Dispatching CHI (p2), PON (p3), RON (p4) ---");

    const chiSuccess = engine.dispatch({ type: 'CALL', playerId: 'p2', meldType: 'CHI', timestamp: Date.now() });
    console.log("Dispatch CHI (p2):", chiSuccess);

    const ponSuccess = engine.dispatch({ type: 'CALL', playerId: 'p3', meldType: 'PON', timestamp: Date.now() });
    console.log("Dispatch PON (p3):", ponSuccess, "(Should be buffered)");

    const ronSuccess = engine.dispatch({ type: 'RON', playerId: 'p4', timestamp: Date.now() });
    console.log("Dispatch RON (p4):", ronSuccess, "(Should resolve priorities)");

    // --- 4. Result Verification ---
    state = engine.getState();
    console.log("\n=== Final State ===");
    console.log("Status:", state.status);
    console.log("Message:", state.message);
    console.log("Scores:", state.scores);
}

testMahjongPriorityAndScoring().catch(e => console.error(e));
