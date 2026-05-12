import { NextResponse } from "next/server";

import { bootstrapConfig } from "@/lib/bootstrap-config";

export function GET() {
  return NextResponse.json(bootstrapConfig);
}
