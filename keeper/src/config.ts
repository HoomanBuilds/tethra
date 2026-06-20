export const RPC = process.env.RPC_URL ?? 'https://fullnode.testnet.sui.io:443';
export const INDEXER = process.env.PREDICT_INDEXER ?? 'https://predict-server.testnet.mystenlabs.com';
export const PREDICT_PKG = process.env.PREDICT_PKG ?? '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
export const PREDICT_OBJ = process.env.PREDICT_OBJ ?? '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
export const DUSDC_TYPE = process.env.DUSDC_TYPE ?? '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
export const CLOCK = '0x6';

// Tethra Predict vault + tPLP/dUSDC borrow market (collateral = vault shares).
export const VAULT_ID = process.env.VAULT_ID ?? '0x21528665ba5731f9ffa2a7fe3024f87b77b86660a615118e2e3d1d150299aeb0';
export const BORROW_PKG = process.env.BORROW_PKG ?? '0x2bfa7a256d2dcb170e8d63d211b822874aa701599615afd5ec94c2338b6cfddd';
export const BORROW_MARKET = process.env.BORROW_MARKET ?? '0x06f2e438b20f78795eaccedbed96dbd41aeae8bec0feb8e6f6be4def95656145';
export const POLL_MS = Number(process.env.POLL_MS ?? 60_000);
export const MAX_REDEEMS_PER_TICK = Number(process.env.MAX_REDEEMS ?? 25);
