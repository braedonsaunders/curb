import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { generateOutreachEmail } from '@/lib/core/outreach';

export async function POST(request: NextRequest) {
  try {
    initializeDatabase();

    const body = await request.json();
    const { businessId } = body;

    if (!businessId || typeof businessId !== 'number') {
      return NextResponse.json(
        { error: 'businessId is required and must be a number' },
        { status: 400 }
      );
    }

    const email = await generateOutreachEmail(businessId);

    return NextResponse.json({
      success: true,
      email: {
        id: email.emailId,
        businessId: email.businessId,
        businessName: email.businessName,
        subject: email.subject,
        toAddress: email.toAddress,
        status: email.status,
      },
    });
  } catch (err) {
    console.error('Outreach error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message.includes('not found') ? 404
      : message.includes('API_KEY') || message.includes('API key') ? 422
      : 500;
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
