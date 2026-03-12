import { NextRequest, NextResponse } from "next/server";

import {
  buildFormCorsHeaders,
  submitSharedFormRequest,
} from "@/lib/form-service";

function corsResponse(
  request: NextRequest,
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: buildFormCorsHeaders(request.headers.get("origin")),
  });
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: buildFormCorsHeaders(request.headers.get("origin")),
  });
}

export async function POST(request: NextRequest) {
  try {
    await submitSharedFormRequest(request);
    return corsResponse(request, {
      ok: true,
      message: "Your message has been sent.",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to send your message right now.";

    return corsResponse(
      request,
      {
        ok: false,
        error: message,
      },
      400
    );
  }
}

