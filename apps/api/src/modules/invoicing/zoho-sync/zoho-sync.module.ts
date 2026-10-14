import { Module } from '@nestjs/common';
import { AccountingModule } from '../../../shared/adapters/accounting/accounting.module.js';
import { IntegrationsModule } from '../../platform/modules.js';
import { ZohoActivityService } from './application/zoho-activity.service.js';
import { ZohoConnectController } from './interface/zoho-connect.controller.js';
import { ZohoPullService } from './application/zoho-pull.service.js';
import { ZohoSandboxController } from './interface/zoho-sandbox.controller.js';
import { ZohoSandboxService } from './application/zoho-sandbox.service.js';
import { ZohoScheduledSyncService } from './application/zoho-scheduled-sync.service.js';
import { ZohoSyncService } from './application/zoho-sync.service.js';
import { ZohoWebhookController } from './interface/zoho-webhook.controller.js';
import { ZohoWebhookService } from './application/zoho-webhook.service.js';

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
