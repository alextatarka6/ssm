class Stock {
  constructor({ assetId, issuerUserId, totalSupply, name }) {
    this.assetId = assetId;
    this.issuerUserId = issuerUserId;
    this.totalSupply = totalSupply;
    this.name = name;
  }

  toJSON() {
    return {
      assetId: this.assetId,
      issuerUserId: this.issuerUserId,
      totalSupply: this.totalSupply,
      name: this.name,
    };
  }
}

module.exports = Stock;
