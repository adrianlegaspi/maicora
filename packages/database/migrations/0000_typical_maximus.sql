CREATE TYPE "public"."membership_role" AS ENUM('OWNER', 'ADMIN', 'STAFF', 'VIEWER');--> statement-breakpoint
CREATE TYPE "public"."customer_kind" AS ENUM('BUSINESS', 'INDIVIDUAL', 'PUBLICO_GENERAL');--> statement-breakpoint
CREATE TYPE "public"."product_kind" AS ENUM('PRODUCT', 'SERVICE');--> statement-breakpoint
CREATE TYPE "public"."cost_component_type" AS ENUM('MATERIAL', 'PURCHASE_COST', 'MACHINE_TIME', 'EQUIPMENT_ALLOCATION', 'ENERGY', 'LABOR', 'PACKAGING', 'FREIGHT', 'DELIVERY', 'WASTE', 'TRANSACTION_FEE', 'MARKETPLACE_FEE', 'FIXED_OVERHEAD', 'VARIABLE_OVERHEAD', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."cost_pattern" AS ENUM('RESALE', 'MANUFACTURED', 'SERVICE');--> statement-breakpoint
CREATE TYPE "public"."changeset_action" AS ENUM('CREATE', 'UPDATE', 'ADJUST', 'EXECUTE', 'CANCEL', 'REVERT');--> statement-breakpoint
CREATE TYPE "public"."proposal_kind" AS ENUM('CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'PRICE_UPDATE', 'INVENTORY_ADJUSTMENT', 'INVOICE_CREATE', 'GLOBAL_INVOICE_CREATE', 'CREDIT_NOTE_CREATE', 'INVOICE_CANCELLATION');--> statement-breakpoint
CREATE TYPE "public"."proposal_risk" AS ENUM('AUTOMATIC', 'DRAFT', 'APPROVAL_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."inventory_movement_type" AS ENUM('OPENING_BALANCE', 'MANUAL_ADJUSTMENT', 'INVOICE_OUT', 'INVOICE_REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."movement_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."fiscal_environment" AS ENUM('SANDBOX', 'PRODUCTION');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('INGRESO', 'EGRESO', 'GLOBAL');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'STAMPED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'ERROR');--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'STAFF' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_memberships_tenant_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"street" text,
	"exterior_number" text,
	"interior_number" text,
	"neighborhood" text,
	"municipality" text,
	"state" text,
	"country" text DEFAULT 'MEX' NOT NULL,
	"postal_code" text,
	"is_fiscal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"kind" "customer_kind" DEFAULT 'BUSINESS' NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text,
	"rfc" text,
	"tax_regime" text,
	"fiscal_postal_code" text,
	"cfdi_use_default" text,
	"email" text,
	"phone" text,
	"notes" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" "product_kind" DEFAULT 'PRODUCT' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sale_price" numeric(18, 6) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"tax_rate" numeric(6, 4) DEFAULT '0.16' NOT NULL,
	"sat_product_code" text,
	"internal_unit" text DEFAULT 'pza' NOT NULL,
	"sat_unit_code" text,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"current_estimated_cost" numeric(18, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_sku_unique" UNIQUE("tenant_id","sku")
);
--> statement-breakpoint
CREATE TABLE "cost_components" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_model_id" uuid NOT NULL,
	"type" "cost_component_type" NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "cost_models" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"pattern" "cost_pattern" NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"target_margin" numeric(6, 4),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "cost_models_product_version_unique" UNIQUE("product_id","version")
);
--> statement-breakpoint
CREATE TABLE "changesets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"proposal_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "changeset_action" NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reversible" boolean DEFAULT false NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by_changeset_id" uuid,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "proposal_kind" NOT NULL,
	"status" "proposal_status" DEFAULT 'DRAFT' NOT NULL,
	"risk" "proposal_risk" NOT NULL,
	"payload" jsonb NOT NULL,
	"diff" jsonb NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_by_agent" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"executed_at" timestamp with time zone,
	"execution_result" jsonb,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_tenant_idempotency_unique" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity_on_hand" numeric(18, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_warehouse_product_unique" UNIQUE("warehouse_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"movement_type" "inventory_movement_type" NOT NULL,
	"direction" "movement_direction" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"source" text NOT NULL,
	"actor_id" uuid,
	"changeset_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouses_tenant_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "fiscal_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"environment" "fiscal_environment" DEFAULT 'SANDBOX' NOT NULL,
	"pac_provider" text DEFAULT 'mock' NOT NULL,
	"rfc_emisor" text,
	"legal_name_emisor" text,
	"regimen_fiscal" text,
	"lugar_expedicion" text,
	"csd_cert_ref" text,
	"csd_key_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_settings_tenant_environment_unique" UNIQUE("tenant_id","environment")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"line_number" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"discount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(6, 4) DEFAULT '0.16' NOT NULL,
	"tax_amount" numeric(18, 6) NOT NULL,
	"total" numeric(18, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid,
	"kind" "invoice_kind" DEFAULT 'INGRESO' NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"environment" "fiscal_environment" DEFAULT 'SANDBOX' NOT NULL,
	"currency" text DEFAULT 'MXN' NOT NULL,
	"subtotal" numeric(18, 6) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"payment_form" text,
	"payment_method" text,
	"cfdi_use" text,
	"place_of_issuance" text,
	"related_invoice_id" uuid,
	"uuid_fiscal" text,
	"xml_storage_path" text,
	"pdf_storage_path" text,
	"cancellation_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stamped_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "invoices_tenant_idempotency_unique" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_memory_tenant_user_key_unique" UNIQUE("tenant_id","user_id","key")
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"tool_calls" jsonb,
	"tool_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_cost_model_id_cost_models_id_fk" FOREIGN KEY ("cost_model_id") REFERENCES "public"."cost_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_models" ADD CONSTRAINT "cost_models_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_models" ADD CONSTRAINT "cost_models_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changesets" ADD CONSTRAINT "changesets_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_changeset_id_changesets_id_fk" FOREIGN KEY ("changeset_id") REFERENCES "public"."changesets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_settings" ADD CONSTRAINT "fiscal_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_addresses_tenant_customer_idx" ON "customer_addresses" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_contacts_tenant_customer_idx" ON "customer_contacts" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_idx" ON "customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_display_name_idx" ON "customers" USING btree ("tenant_id","display_name");--> statement-breakpoint
CREATE INDEX "customers_tenant_rfc_idx" ON "customers" USING btree ("tenant_id","rfc");--> statement-breakpoint
CREATE INDEX "products_tenant_name_idx" ON "products" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "cost_components_tenant_model_idx" ON "cost_components" USING btree ("tenant_id","cost_model_id");--> statement-breakpoint
CREATE INDEX "cost_models_tenant_product_idx" ON "cost_models" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "changesets_tenant_entity_idx" ON "changesets" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "changesets_tenant_created_idx" ON "changesets" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "proposals_tenant_status_idx" ON "proposals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "inventory_balances_tenant_idx" ON "inventory_balances" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_product_idx" ON "inventory_movements" USING btree ("tenant_id","product_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_warehouse_idx" ON "inventory_movements" USING btree ("tenant_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_created_idx" ON "inventory_movements" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_items_tenant_invoice_idx" ON "invoice_items" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "invoices_tenant_customer_idx" ON "invoices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_action_idx" ON "audit_log" USING btree ("tenant_id","action");--> statement-breakpoint
CREATE INDEX "agent_conversations_tenant_user_idx" ON "agent_conversations" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "agent_messages_tenant_conversation_idx" ON "agent_messages" USING btree ("tenant_id","conversation_id");