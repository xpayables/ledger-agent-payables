export const usd = (amount) => Math.round(amount * 1_000_000);
export const fromAtomic = (amountAtomic) => Number((amountAtomic / 1_000_000).toFixed(6));
