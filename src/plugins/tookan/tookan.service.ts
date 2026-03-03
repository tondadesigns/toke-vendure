import { Injectable } from '@nestjs/common';
import {
  RequestContext,
  TransactionalConnection,
  Order,
  OrderService,
  RequestContextService,
} from '@vendure/core';

type TookanCreateTaskResponse = {
  status?: number;
  message?: string;
  data?: {
    job_id?: string | number;
    tracking_link?: string;
    order_id?: string | number;
  };
};

@Injectable()
export class TookanService {
  private apiKey = process.env.TOOKAN_API_KEY || '';
  private baseUrl = process.env.TOOKAN_BASE_URL || 'https://api.tookanapp.com';

  constructor(
    private connection: TransactionalConnection,
    private orderService: OrderService,
    private ctxService: RequestContextService,
  ) {}

  private async getAdminCtx() {
    const channelToken = process.env.VENDURE_CHANNEL_TOKEN;
    if (!channelToken) {
      throw new Error('Missing VENDURE_CHANNEL_TOKEN');
    }

    return this.ctxService.create({
      apiType: 'admin',
      channelOrToken: channelToken,
    });
  }

  async createTaskForOrder(orderId: string) {
    const ctx = await this.getAdminCtx();

    const order = await this.connection.getRepository(ctx, Order).findOne({
      where: { id: orderId as any },
      relations: ['customer', 'lines', 'lines.productVariant'],
    });

    if (!order) {
      return { ok: false, error: 'Order not found' };
    }

    // ==============================
    // 🧪 MODE SIMULATION
    // ==============================
    if (!this.apiKey) {
      const fakeJobId = `SIM-${Date.now()}`;
      const fakeTrackingUrl = `https://tracking.toke.app/${fakeJobId}`;

      await this.orderService.updateCustomFields(ctx, order.id, {
        tookanTaskId: fakeJobId,
        trackingUrl: fakeTrackingUrl,
        deliveryStatus: 'task_created',
      } as any);

      return {
        ok: true,
        simulated: true,
        jobId: fakeJobId,
        trackingUrl: fakeTrackingUrl,
      };
    }

    // ==============================
    // 🚀 MODE RÉEL TOOKAN
    // ==============================

    const shipping = (order as any).shippingAddress || {};

    const orderSummary = order.lines
      .map(l => `${l.quantity}x ${(l as any).productVariant?.name || 'Item'}`)
      .join(', ');

    const payload = {
      api_key: this.apiKey,
      order_id: order.code,
      job_description: orderSummary || `Order ${order.code}`,
      customer_email: order.customer?.emailAddress || 'client@test.com',

      pickup_customer_name: 'Restaurant',
      pickup_customer_phone: '000',
      pickup_address: 'Restaurant Address',

      customer_username: shipping.fullName || 'Client',
      customer_phone: shipping.phoneNumber || '000',
      customer_address: shipping.streetLine1 || shipping.city || '',

      meta_data: [
        { label: 'vendureOrderId', data: String(order.id) },
        { label: 'total', data: String(order.totalWithTax) },
      ],
    };

    const res = await fetch(`${this.baseUrl}/v2/create_task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = (await res.json()) as TookanCreateTaskResponse;

    const jobId = json?.data?.job_id ? String(json.data.job_id) : null;
    const trackingUrl = json?.data?.tracking_link || null;

    if (!jobId) {
      return {
        ok: false,
        error: json?.message || 'Tookan create_task failed',
        raw: json,
      };
    }

    await this.orderService.updateCustomFields(ctx, order.id, {
      tookanTaskId: jobId,
      trackingUrl,
      deliveryStatus: 'task_created',
    } as any);

    return { ok: true, jobId, trackingUrl };
  }

  async handleWebhook(body: any) {
    const ctx = await this.getAdminCtx();

    const jobId = body?.job_id ? String(body.job_id) : null;
    const status = body?.status || body?.job_status || null;

    if (!jobId) return { ok: false, error: 'Missing job_id' };

    const mapped =
      status === 'started' ? 'en_route' :
      status === 'arrived' ? 'arrived' :
      status === 'completed' ? 'delivered' :
      'in_progress';

    const repo = this.connection.getRepository(ctx, Order);
    const order = await repo.findOne({
      where: { customFields: { tookanTaskId: jobId } as any } as any,
    });

    if (!order) return { ok: false, error: 'Order not found' };

    await this.orderService.updateCustomFields(ctx, order.id, {
      deliveryStatus: mapped,
      deliveredAt: mapped === 'delivered' ? new Date() : undefined,
    } as any);

    return { ok: true };
  }
}