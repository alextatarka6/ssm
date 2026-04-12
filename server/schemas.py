from enum import Enum
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, PositiveInt


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class UserCreate(BaseModel):
    user_id: Annotated[str, Field(min_length=1)]
    initial_cash_cents: Annotated[int, Field(ge=0)] = 0


class AssetCreate(BaseModel):
    issuer_user_id: Annotated[str, Field(min_length=1)]
    asset_id: Annotated[str, Field(min_length=1)]
    total_supply: PositiveInt = 1000
    name: Optional[str] = None


class OrderCreate(BaseModel):
    user_id: Annotated[str, Field(min_length=1)]
    asset_id: Annotated[str, Field(min_length=1)]
    side: Side
    qty: PositiveInt
    limit_price_cents: PositiveInt


class OrderResponse(BaseModel):
    id: int
    user_id: str
    asset_id: str
    side: Side
    qty: int
    remaining_qty: int
    limit_price_cents: int
    status: str
    seq: int


class TradeResponse(BaseModel):
    id: int
    asset_id: str
    price_cents: int
    qty: int
    buy_order_id: int
    sell_order_id: int
    buyer_id: str
    seller_id: str


class OrderSubmissionResponse(BaseModel):
    order: OrderResponse
    trades: List[TradeResponse]
