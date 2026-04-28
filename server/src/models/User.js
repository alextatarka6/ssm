class User {
  constructor({ userId, cashCents = 0, reservedCashCents = 0, username = null, avatarUrl = null, isBot = false }) {
    this.userId = userId;
    this.cashCents = cashCents;
    this.reservedCashCents = reservedCashCents;
    this.username = username || null;
    this.avatarUrl = avatarUrl || null;
    this.isBot = isBot === true;
  }

  toJSON() {
    return {
      userId: this.userId,
      cashCents: this.cashCents,
      reservedCashCents: this.reservedCashCents,
      username: this.username,
      avatarUrl: this.avatarUrl,
      isBot: this.isBot,
    };
  }
}

module.exports = User;
