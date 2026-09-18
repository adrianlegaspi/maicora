import type { Decimal } from "decimal.js";

export type CostPattern = "RESALE" | "MANUFACTURED" | "SERVICE";

export type CostComponentType =
  | "MATERIAL"
  | "PURCHASE_COST"
  | "MACHINE_TIME"
  | "EQUIPMENT_ALLOCATION"
  | "ENERGY"
  | "LABOR"
  | "PACKAGING"
  | "FREIGHT"
  | "DELIVERY"
  | "WASTE"
  | "TRANSACTION_FEE"
  | "MARKETPLACE_FEE"
  | "FIXED_OVERHEAD"
  | "VARIABLE_OVERHEAD"
  | "OTHER";

export interface CostComponentInput {
  type: CostComponentType;
  label: string;
  amount: Decimal.Value;
  notes?: string;
}

export interface CostModelInput {
  productId: string;
  pattern: CostPattern;
  targetMargin?: Decimal.Value;
  notes?: string;
  components: CostComponentInput[];
}

export interface CostModelRecord {
  id: string;
  productId: string;
  version: number;
  pattern: CostPattern;
  isCurrent: boolean;
  targetMargin: Decimal.Value | null;
  notes: string | null;
  createdAt: Date;
  components: Array<{
    id: string;
    type: CostComponentType;
    label: string;
    amount: string;
    notes: string | null;
  }>;
}

/** Output of docs/mvp/06-pricing-and-costing.md "Pricing Outputs". */
export interface PricingSummary {
  productId: string;
  costModelId: string;
  costModelVersion: number;
  currency: string;
  trueEstimatedCost: string;
  breakEvenPrice: string;
  currentSalePrice: string | null;
  currentMarkup: string | null;
  currentGrossMargin: string | null;
  profitPerUnitAtCurrentPrice: string | null;
  targetMargin: string | null;
  recommendedPriceForTargetMargin: string | null;
  costBreakdown: Array<{ type: CostComponentType; label: string; amount: string }>;
}

export interface ScenarioInput {
  label: string;
  salePrice: Decimal.Value;
}

export interface ScenarioResult {
  label: string;
  salePrice: string;
  markup: string;
  grossMargin: string;
  profitPerUnit: string;
}
