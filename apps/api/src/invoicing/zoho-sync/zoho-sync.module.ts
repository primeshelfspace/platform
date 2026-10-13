import { Module } from '@nestjs/common';
import { AccountingModule } from '../../adapters/accounting/accounting.module.js';
import { IntegrationsModule } from '../../platform/modules.js';
import { ZohoActivityService } from './zoho-activity.service.js';
import { ZohoConnectController } from './zoho-connect.controller.js';
import { ZohoPullService } from './zoho-pull.service.js';
import { ZohoSandboxController } from './zoho-sandbox.controller.js';
import { ZohoSandboxService } from './zoho-sandbox.service.js';
import { ZohoScheduledSyncService } from './zoho-scheduled-sync.service.js';
import { ZohoSyncService } from './zoho-sync.service.js';
import { ZohoWebhookController } from './zoho-webhook.controller.js';
import { ZohoWebhookService } from './zoho-webhook.service.js';

/** Invoicing ↔ Zoho Books sync: push, pull, webhooks, the sandbox and the
 * scheduled tick. The connection itself belongs to the platform's
 * IntegrationsModule. */
@Module({
  imports: [AccountingModule, IntegrationsModule],
  controllers: [ZohoConnectController, ZohoWebhookController, ZohoSandboxController],
  providers: [
    ZohoSyncService,
    ZohoPullService,
    ZohoWebhookService,
    ZohoSandboxService,
    ZohoActivityService,
    ZohoScheduledSyncService,
  ],
  exports: [
    ZohoSyncService,
    ZohoPullService,
    ZohoWebhookService,
    ZohoSandboxService,
    ZohoScheduledSyncService,
  ],
})
export class ZohoSyncModule {}
