import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Automatic website generation is disabled. Generate a website manually from the business detail page.",
    },
    { status: 410 }
  );
}
