import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { MessageLog } from '@/modules/notifications/components/MessageLog';
import type { DeliveryLogRow } from '@/modules/notifications/queries';

describe('MessageLog delivery status badges', () => {
  const mockRows: DeliveryLogRow[] = [
    {
      id: '1',
      channel: 'email',
      status: 'sent',
      notificationType: 'announcement',
      renderedBody: 'Test email',
      attemptedAt: new Date().toISOString(),
    } as DeliveryLogRow,
    {
      id: '2',
      channel: 'sms',
      status: 'simulated',
      notificationType: 'announcement',
      renderedBody: 'Test SMS',
      attemptedAt: new Date().toISOString(),
    } as DeliveryLogRow,
  ];

  it('renders "Sent" badge for email/sent row and "Simulated" badge for sms/simulated row', () => {
    const component = createElement(MessageLog, { rows: mockRows });
    const html = renderToStaticMarkup(component);

    const sentCount = (html.match(/>Sent</g) || []).length;
    const simulatedCount = (html.match(/>Simulated</g) || []).length;

    expect(sentCount).toBe(1);
    expect(simulatedCount).toBe(1);
  });

  it('renders one badge per row when all rows are simulated', () => {
    const simulatedRows: DeliveryLogRow[] = [
      {
        id: '1',
        channel: 'email',
        status: 'simulated',
        notificationType: 'announcement',
        renderedBody: 'Simulated email',
        attemptedAt: new Date().toISOString(),
      } as DeliveryLogRow,
      {
        id: '2',
        channel: 'sms',
        status: 'simulated',
        notificationType: 'announcement',
        renderedBody: 'Simulated SMS',
        attemptedAt: new Date().toISOString(),
      } as DeliveryLogRow,
    ];

    const component = createElement(MessageLog, { rows: simulatedRows });
    const html = renderToStaticMarkup(component);

    const simulatedCount = (html.match(/>Simulated</g) || []).length;
    expect(simulatedCount).toBe(2);
  });

  it('renders "Failed" badge for failed status rows', () => {
    const failedRows: DeliveryLogRow[] = [
      {
        id: '1',
        channel: 'email',
        status: 'failed',
        notificationType: 'announcement',
        renderedBody: 'Failed email',
        attemptedAt: new Date().toISOString(),
      } as DeliveryLogRow,
    ];

    const component = createElement(MessageLog, { rows: failedRows });
    const html = renderToStaticMarkup(component);

    const failedCount = (html.match(/>Failed</g) || []).length;
    expect(failedCount).toBe(1);
  });
});
