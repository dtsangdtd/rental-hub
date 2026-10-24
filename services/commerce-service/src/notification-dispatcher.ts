import https from 'https';
import { Pool } from 'pg';
import { createLogger } from '@rental/common';

const log = createLogger('notification-dispatcher');

export interface LandlordAlertPayload {
  orderId: string;
  orderNumber: string;
  propertyId: string;
  roomNumber: string;
  customerName: string;
  customerPhone: string;
  itemsSummary: string;
  totalAmount: number;
  deliveryType: string;
  paymentMethod: string;
  note?: string | null;
  zaloWebhookUrl?: string | null;
  zaloGroupId?: string | null;
  telegramChatId?: string | null;
}

export async function dispatchLandlordNotifications(pool: Pool, alert: LandlordAlertPayload): Promise<void> {
  const deliveryLabel =
    alert.deliveryType === 'ROOM_DELIVERY'
      ? 'Giao lên tận phòng'
      : alert.deliveryType === 'LOBBY_PICKUP'
        ? 'Lấy tại sảnh / lễ tân'
        : 'Giao tiêu chuẩn';

  const paymentLabel =
    alert.paymentMethod === 'DEBT_ADDED_TO_RENT'
      ? 'Ghi nợ tiền trọ cuối tháng'
      : alert.paymentMethod === 'VIETQR'
        ? 'Chuyển khoản VietQR'
        : 'Tiền mặt khi nhận (COD)';

  const formattedAmount = `${Number(alert.totalAmount).toLocaleString('vi-VN')} đ`;

  // 1. Lưu thông báo vào bảng notifications
  let sentTelegram = false;
  let sentZalo = false;

  // 2. Gửi Telegram Bot nếu có chat ID
  if (alert.telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
    const text =
      `📦 *[ĐƠN HÀNG MỚI]* - *${alert.roomNumber}*\n` +
      `------------------------------------\n` +
      `👤 *Khách:* ${alert.customerName} (${alert.customerPhone})\n` +
      `🛍️ *Món:* ${alert.itemsSummary}\n` +
      `💰 *Tổng tiền:* ${formattedAmount}\n` +
      `🛵 *Hình thức:* ${deliveryLabel}\n` +
      `💳 *Thanh toán:* ${paymentLabel}\n` +
      (alert.note ? `📝 *Ghi chú:* ${alert.note}\n` : '') +
      `------------------------------------\n` +
      `👉 *Vui lòng soạn hàng và mang lên ${alert.roomNumber}!*`;

    sentTelegram = await postJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: alert.telegramChatId,
      text,
      parse_mode: 'Markdown',
    });
  }

  // 3. Gửi Zalo Webhook nếu có cấu hình
  if (alert.zaloWebhookUrl) {
    const zaloText =
      `📦 [ĐƠN HÀNG MỚI] - ${alert.roomNumber}\n` +
      `----------------------------------------\n` +
      `- Khách đặt: ${alert.customerName} (${alert.customerPhone})\n` +
      `- Danh sách món: ${alert.itemsSummary}\n` +
      `- Tổng thanh toán: ${formattedAmount}\n` +
      `- Thanh toán: ${paymentLabel}\n` +
      `- Ghi chú: ${alert.note || 'Không có'}\n` +
      `----------------------------------------\n` +
      `👉 Vui lòng soạn hàng và mang lên ${alert.roomNumber}!`;

    sentZalo = await postJson(alert.zaloWebhookUrl, {
      recipient: alert.zaloGroupId ? { group_id: alert.zaloGroupId } : undefined,
      message: { text: zaloText },
    });
  }

  // 4. Lưu bản ghi notification
  try {
    await pool.query(
      `INSERT INTO notifications (property_id, type, title, body, metadata_json, sent_telegram, sent_zalo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        alert.propertyId,
        'NEW_GROCERY_ORDER',
        `Đơn hàng mới ${alert.roomNumber} - ${formattedAmount}`,
        `Khách ${alert.customerName} (${alert.customerPhone}) đặt đơn #${alert.orderNumber}: ${alert.itemsSummary}`,
        JSON.stringify(alert),
        sentTelegram,
        sentZalo,
      ],
    );
  } catch (err) {
    log.error({ err }, 'Failed to insert notification record');
  }
}

function postJson(urlStr: string, data: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(urlStr);
      const body = JSON.stringify(data);
      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 5000,
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', () => resolve(res.statusCode ? res.statusCode < 400 : false));
        },
      );
      req.on('error', (err) => {
        log.warn({ err: err.message, url: urlStr }, 'Failed to send external webhook notification');
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.write(body);
      req.end();
    } catch {
      resolve(false);
    }
  });
}
