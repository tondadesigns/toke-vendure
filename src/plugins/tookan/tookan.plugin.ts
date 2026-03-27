import { PluginCommonModule, VendurePlugin, Api, Ctx, RequestContext } from '@vendure/core';
import { Controller, Post, Body } from '@nestjs/common';
import { TookanService } from './tookan.service';

@Controller('tookan')
class TookanController {
  constructor(private tookan: TookanService) {}

  @Post('create-task')
  async createTask(@Body() body: { orderId: string }) {
    // simple endpoint pour tests
    return this.tookan.createTaskForOrder(body.orderId);
  }

  @Post('webhook')
  async webhook(@Body() body: any) {
    // Tookan -> update status
    return this.tookan.handleWebhook(body);
  }
}

@VendurePlugin({
  imports: [PluginCommonModule],
  providers: [TookanService],
  controllers: [TookanController],
  compatibility: '^3.0.0',
})
export class TookanPlugin {}