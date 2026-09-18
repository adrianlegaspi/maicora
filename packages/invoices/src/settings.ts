import { schema, type Database } from "@maicora/database";
import { newId, type ActorContext } from "@maicora/shared";
import { assertPermission, PERMISSIONS } from "@maicora/tenancy";
import type { FiscalEnvironment } from "@maicora/cfdi";
import { InvoiceRepository, type FiscalSettingsRow } from "./repository.js";

export interface FiscalSettingsInput {
  environment: FiscalEnvironment;
  rfcEmisor: string;
  legalNameEmisor: string;
  regimenFiscal: string;
  lugarExpedicion: string;
  pacProvider?: string;
  /**
   * References to the CSD certificate and key held by the fiscal engine, not
   * the material itself: the .cer/.key never enter the Node process or this
   * database (docs/mvp/07-invoicing-cfdi.md).
   */
  csdCertRef?: string | null;
  csdKeyRef?: string | null;
}

/** Screens 17 and 18 (Fiscal settings, CSD/PAC setup). Admin-only both ways. */
export class FiscalSettingsService {
  constructor(private readonly db: Database) {}

  async get(actor: ActorContext, environment: FiscalEnvironment): Promise<FiscalSettingsRow | null> {
    assertPermission(actor, PERMISSIONS.FISCAL_SETTINGS_MANAGE);
    return new InvoiceRepository(this.db).getFiscalSettings(actor, environment);
  }

  async save(actor: ActorContext, input: FiscalSettingsInput): Promise<FiscalSettingsRow> {
    assertPermission(actor, PERMISSIONS.FISCAL_SETTINGS_MANAGE);

    const [row] = await this.db
      .insert(schema.fiscalSettings)
      .values({ id: newId(), tenantId: actor.tenantId, ...input })
      .onConflictDoUpdate({
        target: [schema.fiscalSettings.tenantId, schema.fiscalSettings.environment],
        set: { ...input, updatedAt: new Date() },
      })
      .returning();

    return row as FiscalSettingsRow;
  }
}
