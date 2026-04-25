class User {
  constructor({ userId, cashCents = 0, reservedCashCents = 0, username = null, avatarUrl = null }) {
    this.userId = userId;
    this.cashCents = cashCents;
    this.reservedCashCents = reservedCashCents;
    this.username = username || null;
    this.avatarUrl = avatarUrl || null;
  }

  toJSON() {
    return {
      userId: this.userId,
      cashCents: this.cashCents,
      reservedCashCents: this.reservedCashCents,
      username: this.username,
      avatarUrl: this.avatarUrl,
    };
  }
}

module.exports = User;
