import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Website generation is manual-only. Use the generate action on a specific business.",
    },
    { status: 410 }
  );
}
