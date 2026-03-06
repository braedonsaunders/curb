import { NextRequest, NextResponse } from 'next/server';
import { initializeDatabase } from '@/lib/schema';
import { getConfig, clearConfigCache, type Config } from '@/lib/config';

function maskKey(key: string): string {
  if (!key || key.length < 12) return key ? '***' : '';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function getMaskedConfig(): Record<string, unknown> {
  const config = getConfig();
  return {
    ...config,
    anthropicApiKey: maskKey(config.anthropicApiKey),
    googlePlacesApiKey: maskKey(config.googlePlacesApiKey),
    googlePageSpeedApiKey: maskKey(config.googlePageSpeedApiKey),
  };
}

export async function GET() {
  try {
    initializeDatabase();
    const config = getMaskedConfig();
    return NextResponse.json({ settings: config });
  } catch (err) {
    console.error('Get settings error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    initializeDatabase();

    const body = await request.json();

    // For MVP, we accept settings and return them.
    // Real env modification would require server restart.
    // We clear the cache so any env changes take effect on next getConfig() call.
    clearConfigCache();

    const allowedKeys: Array<keyof Config> = [
      'anthropicApiKey',
      'googlePlacesApiKey',
      'googlePageSpeedApiKey',
      'defaultLocation',
      'defaultRadiusKm',
      'ownerName',
      'businessName',
      'businessAddress',
      'businessEmail',
      'siteBaseUrl',
    ];

    const updates: Partial<Config> = {};
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        (updates as Record<string, unknown>)[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid settings to update' },
        { status: 400 }
      );
    }

    // Return the submitted settings merged with current config (masked)
    const currentConfig = getConfig();
    const merged = { ...currentConfig, ...updates };

    // Mask sensitive keys in response
    const response = {
      ...merged,
      anthropicApiKey: maskKey(merged.anthropicApiKey),
      googlePlacesApiKey: maskKey(merged.googlePlacesApiKey),
      googlePageSpeedApiKey: maskKey(merged.googlePageSpeedApiKey),
    };

    return NextResponse.json({
      success: true,
      message: 'Settings received. To persist API key changes, update your .env file and restart the server.',
      settings: response,
    });
  } catch (err) {
    console.error('Update settings error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
