import { NextResponse } from 'next/server';

// Health check endpoint for monitoring and container health checks
export async function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      service: 'web',
      timestamp: new Date().toISOString(),
      version: process.env.VERSION || 'development',
    },
    { status: 200 }
  );
}