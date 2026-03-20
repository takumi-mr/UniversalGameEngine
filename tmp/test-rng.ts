import { ProvablyFairRNG } from 'c:/Users/takumi/Desktop/universal-game-engine/packages/shared/utils/ProvablyFairRNG';

const serverSeed = 'secretServerSeed123';
const clientSeed = 'clientSeed456';

const rng = new ProvablyFairRNG(serverSeed, clientSeed, 0);

console.log('Testing Float (52-bit precision):');
for (let i = 0; i < 5; i++) {
    console.log(rng.nextFloat());
}

console.log('\nTesting Int (Rejection Sampling, Modulo Bias Free):');
const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
for (let i = 0; i < 30000; i++) {
    counts[rng.nextInt(1, 3)]++;
}
console.log('Distribution over 30000 nextInt(1, 3):', counts);
console.log('Final nonce:', rng.getNonce());
