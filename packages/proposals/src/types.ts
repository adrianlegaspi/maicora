import type { BusinessDiff } from "./diff.js";

export type ProposalKind =
  | "CUSTOMER_CREATE"
  | "CUSTOMER_UPDATE"
  | "PRICE_UPDATE"
  | "INVENTORY_ADJUSTMENT"
  | "INVOICE_CREATE"
  | "GLOBAL_INVOICE_CREATE"
  | "CREDIT_NOTE_CREATE"
  | "INVOICE_CANCELLATION"
  | "BULK_IMPORT";

export type ProposalStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "EXECUTED" | "EXPIRED";

export type ProposalRisk = "AUTOMATIC" | "DRAFT" | "APPROVAL_REQUIRED";

/**
 * Whether EXECUTING a proposal of this kind needs a human approval step.
 * Every kind's DRAFT (the proposal + diff itself) is always produced
 * automatically - see docs/mvp/09-proposals-and-governance.md, "Draft
 * automatically" vs "Approval required". The spec's approval-required list
 * names actions ("apply inventory adjustment", "change product sale price
 * through agent", "stamp/cancel CFDI", "bulk customer changes") rather than
 * every proposal kind, so a single customer create/update - not being on
 * that list - can self-approve and execute immediately while everything
 * that touches money, stock, or fiscal state cannot.
 */
export const PROPOSAL_KIND_RISK: Record<ProposalKind, ProposalRisk> = {
  CUSTOMER_CREATE: "DRAFT",
  CUSTOMER_UPDATE: "DRAFT",
  PRICE_UPDATE: "APPROVAL_REQUIRED",
  INVENTORY_ADJUSTMENT: "APPROVAL_REQUIRED",
  INVOICE_CREATE: "APPROVAL_REQUIRED",
  GLOBAL_INVOICE_CREATE: "APPROVAL_REQUIRED",
  CREDIT_NOTE_CREATE: "APPROVAL_REQUIRED",
  INVOICE_CANCELLATION: "APPROVAL_REQUIRED",
  BULK_IMPORT: "APPROVAL_REQUIRED",
};

export interface CreateProposalInput {
  kind: ProposalKind;
  payload: Record<string, unknown>;
  diff: BusinessDiff;
  requestedBy: string;
  requestedByAgent?: boolean;
  idempotencyKey: string;
}

export interface ProposalRecord {
  id: string;
  tenantId: string;
  kind: ProposalKind;
  status: ProposalStatus;
  risk: ProposalRisk;
  payload: Record<string, unknown>;
  diff: BusinessDiff;
  requestedBy: string;
  requestedByAgent: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  executedAt: Date | null;
  executionResult: Record<string, unknown> | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChangesetInput {
  /** Supplied by the executor path so ledger rows can reference it; generated otherwise. */
  id?: string;
  proposalId?: string | null;
  entityType: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "ADJUST" | "EXECUTE" | "CANCEL" | "REVERT";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reversible: boolean;
  actorId: string;
}

export interface ChangesetRecord extends ChangesetInput {
  id: string;
  tenantId: string;
  revertedAt: Date | null;
  revertedByChangesetId: string | null;
  createdAt: Date;
}

/** Result an executor returns; becomes the proposal's executionResult plus one ChangeSet. */
export interface ExecutionOutcome {
  entityType: string;
  entityId: string;
  action: ChangesetInput["action"];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reversible: boolean;
  result: Record<string, unknown>;
}
