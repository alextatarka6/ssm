class Holding {
  constructor({ userId, assetId, shares = 0, reservedShares = 0 }) {
    this.userId = userId;
    this.assetId = assetId;
    this.shares = shares;
    this.reservedShares = reservedShares;
  }

  toJSON() {
    return {
      userId: this.userId,
      assetId: this.assetId,
      shares: this.shares,
      reservedShares: this.reservedShares,
    };
  }
}

module.exports = Holding;
