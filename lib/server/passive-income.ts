type IncomeInput = {
  current: number;
  gain: number;
  carry?: number;
  capacity?: number;
};

export function accrueIncome({ current, gain, carry = 0, capacity = Infinity }: IncomeInput) {
  const total = Math.max(0, gain) + Math.max(0, Math.min(carry, 1));
  const whole = Math.floor(total + 1e-9);
  const amount = Math.min(current + whole, capacity);
  return {
    amount,
    carry: amount >= capacity ? 0 : Math.max(0, total - whole),
  };
}
