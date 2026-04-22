class User {
  constructor({ userId, cashCents = 0, reservedCashCents = 0 }) {
    this.userId = userId;
    this.cashCents = cashCents;
    this.reservedCashCents = reservedCashCents;
  }

  toJSON() {
    return {
      userId: this.userId,
      cashCents: this.cashCents,
      reservedCashCents: this.reservedCashCents,
    };
  }
}

module.exports = User;
