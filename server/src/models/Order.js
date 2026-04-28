class Order {
  constructor({
    id,
    userId,
    assetId,
    side,
    qty,
    remainingQty,
    limitPriceCents,
    status,
    seq,
    createdAt,
  }) {
    this.id = id;
    this.userId = userId;
    this.assetId = assetId;
    this.side = side;
    this.qty = qty;
    this.remainingQty = remainingQty;
    this.limitPriceCents = limitPriceCents;
    this.status = status;
    this.seq = seq;
    this.createdAt = createdAt ?? Date.now();
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      assetId: this.assetId,
      side: this.side,
      qty: this.qty,
      remainingQty: this.remainingQty,
      limitPriceCents: this.limitPriceCents,
      status: this.status,
      seq: this.seq,
      createdAt: this.createdAt,
    };
  }
}

module.exports = Order;
