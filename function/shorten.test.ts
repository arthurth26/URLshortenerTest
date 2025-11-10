// netlify/functions/shorten.test.ts

// Mock Supabase BEFORE any imports
jest.doMock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(),
        })),
      })),
      insert: jest.fn(() => ({
        // Mock insert return
      })),
    })),
  })),
}));

// Now import
import { handler } from './shorten';
import crypto from 'crypto';

// --- Mock environment variables ---
process.env.dbURL = 'https://fake.supabase.co';
process.env.apiKey = 'fake-service-key';

// --- Get the mocked Supabase ---
const { createClient } = jest.requireMock('@supabase/supabase-js');
const mockSupabase = createClient();

// --- Mock crypto for deterministic hash ---
const mockDigest = 'a1b2c3d4e5';
jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => ({
      slice: jest.fn().mockReturnValue(mockDigest),
    })),
  })),
}));

// --- Helper: create POST event ---
const createPostEvent = (url?: string) => ({
  httpMethod: 'POST',
  body: url ? JSON.stringify({ url }) : '{}',
  headers: {},
});

// --- Mock Date for predictable hash salt ---
const RealDate = Date;
const mockDate = new Date('2025-11-10T12:00:00Z'); // November 2025 for getMonth() = 10
global.Date = jest.fn(() => mockDate) as any;

describe('shorten function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockSupabase.from as jest.Mock).mockReturnValue({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(),
        })),
      })),
      insert: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.Date = RealDate;
  });

  test('handles OPTIONS preflight', async () => {
    const event = { httpMethod: 'OPTIONS' } as any;
    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(result.body).toBe('');
  });

  test('rejects non-POST methods', async () => {
    const event = { httpMethod: 'GET' } as any;
    const result = await handler(event);

    expect(result.statusCode).toBe(405);
    expect(JSON.parse(result.body)).toEqual({ error: 'Method not allowed' });
  });

  test('rejects invalid JSON', async () => {
    const event = { httpMethod: 'POST', body: 'not-json' } as any;
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ error: 'Invalid JSON' });
  });

  test('rejects missing URL', async () => {
    const event = { httpMethod: 'POST', body: '{}' } as any;
    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ error: 'URL is required' });
  });

  test('rejects invalid URL format', async () => {
    const event = createPostEvent('ftp://bad.com');
    const result = await handler(event as any);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({ error: 'Need proper URL' });
  });

  test('returns existing short code', async () => {
    const mockMaybeSingle = mockSupabase.from().select().eq().maybeSingle as jest.Mock;
    mockMaybeSingle.mockResolvedValue({
      data: { short_code: 'exist123' },
      error: null,
    });

    const event = createPostEvent('https://example.com');
    const result = await handler(event as any);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      shortURL: 'https://notveryshort.netlify.app/exist123',
    });
  });

  test('generates new short code on first try', async () => {
    const mockMaybeSingle = mockSupabase.from().select().eq().maybeSingle as jest.Mock;
    const mockInsert = mockSupabase.from().insert as jest.Mock;
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing
      .mockResolvedValueOnce({ data: null, error: null }); // no collision
    mockInsert.mockResolvedValue({ error: null });

    const event = createPostEvent('https://google.com');
    const result = await handler(event as any);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.shortURL).toContain(mockDigest);
    expect(mockInsert).toHaveBeenCalledWith({
      short_code: mockDigest,
      original_url: 'https://google.com',
    });
  });

  test('retries on collision up to 5 times', async () => {
    const mockMaybeSingle = mockSupabase.from().select().eq().maybeSingle as jest.Mock;
    const mockInsert = mockSupabase.from().insert as jest.Mock;
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing
      .mockResolvedValue({ data: { id: 1 }, error: null }) // 4 collisions
      .mockResolvedValue({ data: { id: 1 }, error: null })
      .mockResolvedValue({ data: { id: 1 }, error: null })
      .mockResolvedValue({ data: { id: 1 }, error: null })
      .mockResolvedValue({ data: null, error: null }); // 5th free
    mockInsert.mockResolvedValue({ error: null });

    const event = createPostEvent('https://retry.com');
    const result = await handler(event as any);

    expect(result.statusCode).toBe(200);
    expect(mockMaybeSingle).toHaveBeenCalledTimes(6);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  test('fails after 5 collisions', async () => {
    const mockMaybeSingle = mockSupabase.from().select().eq().maybeSingle as jest.Mock;
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValue({ data: { id: 1 }, error: null }) // 5 collisions
      .mockResolvedValue({ data: { id: 1 }, error: null })
      .mockResolvedValue({ data: { id: 1 }, error: null })
      .mockResolvedValue({ data: { id: 1 }, error: null })
      .mockResolvedValue({ data: { id: 1 }, error: null });

    const event = createPostEvent('https://fail.com');
    const result = await handler(event as any);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ error: 'failed to generate unique code' });
  });

  test('handles Supabase insert error', async () => {
    const mockMaybeSingle = mockSupabase.from().select().eq().maybeSingle as jest.Mock;
    const mockInsert = mockSupabase.from().insert as jest.Mock;
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mockInsert.mockResolvedValue({ error: { code: 'INSERT_ERROR' } });

    const event = createPostEvent('https://error.com');
    const result = await handler(event as any);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ error: 'Internal Server Error' });
  });

  test('handles PGRST116 error in checkURLinDB', async () => {
    const mockMaybeSingle = mockSupabase.from().select().eq().maybeSingle as jest.Mock;
    const mockInsert = mockSupabase.from().insert as jest.Mock;
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }); // no row
    mockInsert.mockResolvedValue({ error: null });

    const event = createPostEvent('https://pgrst.com');
    const result = await handler(event as any);

    expect(result.statusCode).toBe(200);
    expect(mockInsert).toHaveBeenCalled();
  });

  test('handles other Supabase error in checkURLinDB', async () => {
    const mockMaybeSingle = mockSupabase.from().select().eq().maybeSingle as jest.Mock;
    const mockInsert = mockSupabase.from().insert as jest.Mock;
    mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // no existing
      .mockResolvedValueOnce({ data: null, error: { code: 'OTHER_ERROR' } }); // non-PGRST116 → false
    mockInsert.mockResolvedValue({ error: null });

    const event = createPostEvent('https://other-error.com');
    const result = await handler(event as any);

    expect(result.statusCode).toBe(200);
    expect(mockInsert).toHaveBeenCalled();
  });
});