from enum import Enum
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, PositiveInt


class Side(str, Enum):
    BUY = "BUY"
    SELL = "SELL"


class UserCreate(BaseModel):
    user_id: Annotated[str, Field(min_length=1)]
    initial_cash_cents: Annotated[int, Field(ge=0)] = 500_000


class AssetCreate(BaseModel):
    issuer_user_id: Annotated[str, Field(min_length=1)]
    asset_id: Annotated[str, Field(min_length=1)]
    total_supply: PositiveInt = 1000
    issuer_pct: Annotated[float, Field(gt=0, lt=1)] = 0.4
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


class AssetResponse(BaseModel):
    asset_id: str
    issuer_user_id: str
    total_supply: int
    name: Optional[str]
    last_price_cents: Optional[int]


class HoldingResponse(BaseModel):
    asset_id: str
    shares: int
    reserved_shares: int
    last_price_cents: Optional[int]
    market_value_cents: int


class UserPortfolioResponse(BaseModel):
    user_id: str
    cash_cents: int
    reserved_cash_cents: int
    holdings: List[HoldingResponse]


class CandleBar(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    ha_open: float
    ha_high: float
    ha_low: float
    ha_close: float


class CandleResponse(BaseModel):
    asset_id: str
    bars: List[CandleBar]
