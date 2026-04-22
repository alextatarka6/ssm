class Trade {
  constructor({
    id,
    assetId,
    priceCents,
    qty,
    buyOrderId,
    sellOrderId,
    buyerId,
    sellerId,
    tsSeq,
  }) {
    this.id = id;
    this.assetId = assetId;
    this.priceCents = priceCents;
    this.qty = qty;
    this.buyOrderId = buyOrderId;
    this.sellOrderId = sellOrderId;
    this.buyerId = buyerId;
    this.sellerId = sellerId;
    this.tsSeq = tsSeq;
  }

  toJSON() {
    return {
      id: this.id,
      assetId: this.assetId,
      priceCents: this.priceCents,
      qty: this.qty,
      buyOrderId: this.buyOrderId,
      sellOrderId: this.sellOrderId,
      buyerId: this.buyerId,
      sellerId: this.sellerId,
      tsSeq: this.tsSeq,
    };
  }
}

module.exports = Trade;
