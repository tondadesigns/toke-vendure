import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { Controller, Post, Body } from '@nestjs/common';
import { TookanService } from './tookan.service';

@Controller('tookan')
class TookanController {
  constructor(private tookan: TookanService) {}

  @Post('create-task')
async createTask(@Body() body: { orderId: string }) {
  try {
    return await this.tookan.createTaskForOrder(body.orderId);
  } catch (e: any) {
    console.error('[TOOKAN] create-task error:', e);
    return {
      ok: false,
      message: e?.message || String(e),
      stack: e?.stack?.split('\n').slice(0, 6).join('\n'),
    };
  }
}

  @Post('webhook')
  async webhook(@Body() body: any) {
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